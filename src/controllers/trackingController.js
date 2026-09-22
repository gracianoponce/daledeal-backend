/**
 * Tracking de envíos — endpoints.
 *
 *   GET  /shipping/carriers        público: correos que puede elegir el vendedor
 *   GET  /orders/:id/tracking      comprador/vendedor/admin: estado + línea de tiempo
 *   POST /webhooks/ship24          Ship24 nos empuja los cambios de estado
 *
 * Tolerante a que la migration 016 no esté aplicada (42703/42P01): los GET
 * responden sin datos de tracking y el webhook pide reintento (503).
 */
const db       = require('../config/database');
const tracking = require('../services/tracking');
const { sendEmail, orderDeliveredBuyerTemplate } = require('../services/email');
const { sendShippedNotification } = require('./ordersController');

const migPending = err => !!err && (err.code === '42P01' || err.code === '42703');
const sameNumber = (a, b) =>
  String(a || '').replace(/\s+/g, '').toUpperCase() === String(b || '').replace(/\s+/g, '').toUpperCase();

// El correo ya tiene el paquete en la calle (o lo intentó entregar).
const MOVING = ['in_transit', 'out_for_delivery', 'failed_attempt', 'available_for_pickup'];

// ------------------------------------------------------------
const getCarriers = (req, res) => {
  res.json({ data: tracking.listCarriers(), auto_tracking: tracking.isEnabled() });
};

// ------------------------------------------------------------
const getOrderTracking = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });

  try {
    let order;
    let legacy = false;
    try {
      const r = await db.query(
        `SELECT id, buyer_id, seller_id, status, shipping_method, tracking_number,
                shipping_carrier, tracking_status, tracking_status_at, tracking_provider_id,
                dispatched_at, delivered_at, delivered_source
           FROM orders WHERE id = $1`,
        [id]
      );
      order = r.rows[0];
    } catch (err) {
      if (!migPending(err)) throw err;
      legacy = true;
      const r = await db.query(
        `SELECT id, buyer_id, seller_id, status, shipping_method, tracking_number,
                dispatched_at, delivered_at
           FROM orders WHERE id = $1`,
        [id]
      );
      order = r.rows[0];
    }

    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

    const isParty = order.buyer_id === req.user.id || order.seller_id === req.user.id;
    if (!isParty && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'No tenés permiso para ver esta orden' });
    }

    let events = [];
    if (!legacy) {
      try {
        const ev = await db.query(
          `SELECT status, description, location, occurred_at
             FROM order_tracking_events
            WHERE order_id = $1
            ORDER BY occurred_at DESC, id DESC
            LIMIT 100`,
          [id]
        );
        events = ev.rows;
      } catch (err) {
        if (!migPending(err)) throw err;
      }
    }

    const carrier = tracking.getCarrier(order.shipping_carrier);
    res.json({
      order_id:         order.id,
      order_status:     order.status,
      shipping_method:  order.shipping_method || null,
      carrier:          carrier ? { slug: carrier.slug, name: carrier.name } : null,
      tracking_number:  order.tracking_number || null,
      tracking_url:     tracking.buildTrackingUrl(order.shipping_carrier, order.tracking_number),
      status:           order.tracking_status || null,
      status_label:     tracking.statusLabel(order.tracking_status),
      status_at:        order.tracking_status_at || null,
      dispatched_at:    order.dispatched_at || null,
      delivered_at:     order.delivered_at || null,
      delivered_source: order.delivered_source || null,
      // true = el número está dado de alta en el proveedor y los estados llegan solos
      auto:             !!order.tracking_provider_id,
      events: events.map(e => ({
        status:      e.status,
        label:       tracking.statusLabel(e.status),
        description: e.description,
        location:    e.location,
        occurred_at: e.occurred_at,
      })),
    });
  } catch (err) {
    console.error('Error en getOrderTracking:', err);
    res.status(500).json({ error: 'Error al obtener el seguimiento' });
  }
};

// ------------------------------------------------------------
// Aplica UNA actualización de Ship24. Idempotente y tolerante a desorden:
// Ship24 reintenta hasta 20 veces y no garantiza el orden de llegada.
// Devuelve true si la actualización correspondía a una orden nuestra.
// ------------------------------------------------------------
async function applyTrackingUpdate(item) {
  if (!item.orderId || !item.trackingNumber) return false;

  const r = await db.query(
    `SELECT id, buyer_id, seller_id, status, payment_status, tracking_number, delivered_at
       FROM orders WHERE id = $1`,
    [item.orderId]
  );
  const order = r.rows[0];
  if (!order) return false;
  if (order.status === 'cancelled' || order.status === 'pending') return false;
  // Tracker viejo: el vendedor corrigió el número después de registrarlo.
  if (!sameNumber(order.tracking_number, item.trackingNumber)) return false;

  for (const ev of item.events) {
    await db.query(
      `INSERT INTO order_tracking_events (order_id, provider_event_id, status, description, location, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (order_id, provider_event_id) DO NOTHING`,
      [order.id, ev.id, ev.milestone, ev.description, ev.location, ev.occurredAt]
    );
  }

  if (item.milestone) {
    // El "<=" descarta webhooks que llegan tarde con un estado más viejo.
    await db.query(
      `UPDATE orders
          SET tracking_status      = $2,
              tracking_status_at   = $3,
              tracking_provider_id = COALESCE(tracking_provider_id, $4)
        WHERE id = $1
          AND (tracking_status_at IS NULL OR tracking_status_at <= $3)`,
      [order.id, item.milestone, item.statusAt, item.trackerId]
    );
  }

  if (item.milestone === 'delivered' && ['confirmed', 'shipped'].includes(order.status)) {
    const deliveredEv = item.events.find(e => e.milestone === 'delivered');
    const deliveredAt = deliveredEv ? deliveredEv.occurredAt : item.statusAt;
    // Entrega confirmada por el correo: arranca el reloj del escrow (015) con
    // un dato que no depende de la palabra del vendedor.
    const up = await db.query(
      `UPDATE orders
          SET status = 'delivered',
              delivered_at     = COALESCE(delivered_at, $2),
              dispatched_at    = COALESCE(dispatched_at, $2),
              delivered_source = COALESCE(delivered_source, $3),
              updated_at       = NOW()
        WHERE id = $1 AND status IN ('confirmed','shipped')
        RETURNING id`,
      [order.id, deliveredAt, 'carrier']
    );
    if (up.rowCount > 0) {
      notifyDelivered(order.id).catch(e => console.error('[email] delivered notify failed:', e.message));
    }
  } else if (MOVING.includes(item.milestone) && order.status === 'confirmed') {
    // El vendedor cargó el número pero no tildó "despachado": lo hace el correo.
    const up = await db.query(
      `UPDATE orders
          SET status = 'shipped',
              dispatched_at = COALESCE(dispatched_at, $2),
              updated_at    = NOW()
        WHERE id = $1 AND status = 'confirmed'
        RETURNING id`,
      [order.id, item.statusAt]
    );
    if (up.rowCount > 0) {
      sendShippedNotification(order.id).catch(e => console.error('[email] shipped notify failed:', e.message));
    }
  }

  return true;
}

async function notifyDelivered(orderId) {
  const r = await db.query(
    `SELECT o.id, o.shipping_carrier,
            p.title AS product_title,
            ub.email AS buyer_email, ub.name AS buyer_name
       FROM orders o
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN users ub   ON ub.id = o.buyer_id
      WHERE o.id = $1`,
    [orderId]
  );
  const o = r.rows[0];
  if (!o || !o.buyer_email) return;
  const tpl = orderDeliveredBuyerTemplate({
    buyerName:    o.buyer_name,
    orderId:      o.id,
    productTitle: o.product_title,
    carrierName:  tracking.getCarrier(o.shipping_carrier)?.name || null,
  });
  await sendEmail({ to: o.buyer_email, subject: tpl.subject, html: tpl.html, text: tpl.text });
}

// ------------------------------------------------------------
const ship24Webhook = async (req, res) => {
  const auth = tracking.verifyWebhookSecret(req.headers.authorization);
  if (auth === 'unconfigured') {
    // 5xx → Ship24 reintenta (hasta 20 veces, con backoff): no se pierde nada
    // si el secreto se carga unos minutos después.
    return res.status(503).json({ error: 'Webhook de tracking no configurado' });
  }
  if (auth !== 'ok') return res.status(401).json({ error: 'No autorizado' });

  const items = tracking.parseWebhookBody(req.body);
  let processed = 0;
  try {
    for (const item of items) {
      if (await applyTrackingUpdate(item)) processed++;
    }
  } catch (err) {
    if (migPending(err)) {
      return res.status(503).json({ error: 'Tracking todavía no disponible (migration 016 pendiente)' });
    }
    console.error('Error en ship24Webhook:', err);
    return res.status(500).json({ error: 'Error procesando el webhook' });
  }
  res.json({ received: items.length, processed });
};

module.exports = { getCarriers, getOrderTracking, ship24Webhook };
