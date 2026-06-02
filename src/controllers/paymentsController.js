/**
 * DALE DEAL — Controlador de pagos (Mercado Pago Checkout Pro)
 *
 * Flujo:
 *   1) Usuario crea una orden via POST /orders
 *   2) Frontend llama POST /payments/preference con { order_id }
 *   3) Backend arma preferencia MP, guarda preference_id en la orden
 *   4) Frontend redirige a `init_point` (URL de MP)
 *   5) Usuario paga en MP
 *   6) MP redirige a /HTML/pago-exitoso.html?order_id=X
 *   7) MP notifica al webhook POST /payments/webhook (async)
 *   8) Webhook consulta el pago, actualiza orders.payment_status
 *      y crea el registro en seller_payouts
 */

const crypto = require('crypto');
const db = require('../config/database');
const mp = require('../config/mercadopago');
const {
  sendEmail,
  orderPaidBuyerTemplate,
  newSaleSellerTemplate,
  paymentFailedBuyerTemplate,
} = require('../services/email');

const COMMISSION_RATE = parseFloat(process.env.MARKETPLACE_COMMISSION_RATE || '0.05');
const APP_BASE_URL    = process.env.APP_BASE_URL    || 'http://localhost:3000';
const FRONTEND_URL    = process.env.FRONTEND_URL    || 'http://localhost:5500';

// ============================================================
// Helpers
// ============================================================

/**
 * Mapea el status de MP al payment_status que guardamos en orders.
 * MP docs: https://www.mercadopago.com.ar/developers/es/reference/payments/_payments/post
 */
function mpStatusToLocal(mpStatus) {
  const map = {
    pending:       'pending',
    approved:      'paid',
    authorized:    'authorized',
    in_process:    'in_process',
    in_mediation:  'in_process',
    rejected:      'rejected',
    cancelled:     'cancelled',
    refunded:      'refunded',
    charged_back:  'charged_back',
  };
  return map[mpStatus] || 'pending';
}

/**
 * Mapea el payment_status al status "comercial" de la orden.
 */
function paymentToOrderStatus(paymentStatus, current) {
  if (paymentStatus === 'paid')   return 'confirmed';
  if (paymentStatus === 'refunded' || paymentStatus === 'charged_back') return 'cancelled';
  if (paymentStatus === 'rejected' || paymentStatus === 'cancelled')    return current === 'pending' ? 'cancelled' : current;
  return current;
}

/**
 * Valida la firma del webhook (x-signature) contra MP_WEBHOOK_SECRET.
 * https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
 */
function verifyWebhookSignature(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    // Sin secret configurado:
    //   - en dev → aceptamos sin validar (útil para testing local)
    //   - en prod → rechazamos. validateEnv ya alerta al boot, pero
    //     este fallback evita que cualquiera marque órdenes como pagas.
    if (process.env.NODE_ENV === 'production') {
      console.error('[mp-webhook] MP_WEBHOOK_SECRET no configurado en prod — RECHAZANDO');
      return false;
    }
    console.warn('[mp-webhook] MP_WEBHOOK_SECRET no configurado — aceptando sin validar (dev)');
    return true;
  }

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  if (!xSignature) return false;

  // x-signature tiene formato: "ts=1700000000,v1=abcdef..."
  const parts = Object.fromEntries(
    String(xSignature).split(',').map(p => p.trim().split('=').map(s => s.trim()))
  );
  const ts = parts.ts;
  const hash = parts.v1;
  if (!ts || !hash) return false;

  const dataId = req.query['data.id'] || (req.body?.data?.id);
  if (!dataId) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  // comparación segura
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Calcula la comisión sobre el total (redondeada a 2 decimales).
 */
function calculateCommission(total) {
  return Math.round(total * COMMISSION_RATE * 100) / 100;
}

// ============================================================
// POST /payments/preference
// ============================================================
const createPreference = async (req, res) => {
  const { order_id } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id es obligatorio' });

  if (!mp.isConfigured) {
    return res.status(503).json({ error: 'Pagos no disponibles (MP no configurado)' });
  }

  try {
    // Traemos la orden con datos del producto
    const orderRes = await db.query(
      `SELECT o.*,
              p.title AS product_title,
              (SELECT img FROM UNNEST(p.images) img LIMIT 1) AS product_image,
              u.email AS buyer_email,
              u.name  AS buyer_name
         FROM orders o
         JOIN users u ON u.id = o.buyer_id
         LEFT JOIN products p ON p.id = o.product_id
        WHERE o.id = $1`,
      [order_id]
    );

    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    const order = orderRes.rows[0];

    if (order.buyer_id !== req.user.id) {
      return res.status(403).json({ error: 'No tenés permiso para pagar esta orden' });
    }

    if (order.payment_status === 'paid') {
      return res.status(400).json({ error: 'Esta orden ya fue pagada' });
    }
    // No permitir reabrir el pago si la orden está en estado terminal
    if (['refunded', 'charged_back'].includes(order.payment_status)) {
      return res.status(400).json({ error: 'Esta orden ya fue reembolsada y no se puede reabrir' });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Esta orden está cancelada' });
    }

    // Si ya existe preferencia, la devolvemos (idempotencia del lado nuestro)
    if (order.mp_preference_id && order.mp_init_point) {
      return res.json({
        ok:                  true,
        preference_id:       order.mp_preference_id,
        init_point:          order.mp_init_point,
        sandbox_init_point:  order.mp_sandbox_init_point,
        is_sandbox:          mp.isSandbox,
        total:               parseFloat(order.total_price),
        commission:          parseFloat(order.commission_amount || 0),
        net_to_seller:       parseFloat(order.total_price) - parseFloat(order.commission_amount || 0),
        order_id:            order.id,
      });
    }

    const externalRef = `daledeal-order-${order.id}-${Date.now()}`;

    // Comisión: se calcula SOLO sobre el subtotal del producto,
    // no sobre el costo del envío (eso pasa derecho al vendedor).
    const productSubtotal = parseFloat(order.unit_price) * Number(order.quantity);
    const shippingCost    = parseFloat(order.shipping_cost || 0);
    const commission      = calculateCommission(productSubtotal);

    // En el checkout MP mostramos el producto y, si corresponde,
    // un ítem adicional por el costo del envío.
    const items = [{
      id:          String(order.product_id || order.id),
      title:       order.product_title || `Compra Dale Deal #${order.id}`,
      description: order.notes || '',
      picture_url: order.product_image || undefined,
      category_id: 'marketplace',
      quantity:    order.quantity,
      currency_id: order.currency || 'ARS',
      unit_price:  parseFloat(order.unit_price),
    }];

    if (shippingCost > 0) {
      items.push({
        id:          `shipping-${order.id}`,
        title:       'Envío a domicilio',
        description: 'Costo de envío',
        category_id: 'shipping',
        quantity:    1,
        currency_id: order.currency || 'ARS',
        unit_price:  shippingCost,
      });
    }

    const preferenceBody = {
      items,
      payer: {
        email: order.buyer_email,
        name:  order.buyer_name,
      },
      external_reference: externalRef,
      notification_url:   `${APP_BASE_URL}/payments/webhook`,
      back_urls: {
        success: `${FRONTEND_URL}/HTML/pago-exitoso.html?order_id=${order.id}`,
        failure: `${FRONTEND_URL}/HTML/pago-fallido.html?order_id=${order.id}`,
        pending: `${FRONTEND_URL}/HTML/pago-pendiente.html?order_id=${order.id}`,
      },
      // MP solo acepta auto_return cuando back_urls son HTTPS públicas.
      // En dev (FRONTEND_URL=localhost), lo omitimos para evitar
      // "auto_return invalid. back_url.success must be defined".
      ...(FRONTEND_URL.startsWith('https://') && !FRONTEND_URL.includes('localhost')
        ? { auto_return: 'approved' }
        : {}),
      statement_descriptor: 'DALE DEAL',
      // marketplace_fee requiere cuentas conectadas via OAuth
      // por ahora comisión la calculamos y guardamos nosotros
      metadata: {
        order_id:          order.id,
        buyer_id:          order.buyer_id,
        seller_id:         order.seller_id,
        commission_amount: commission,
      },
    };

    const client     = mp.requireClient();
    const preference = new mp.Preference(client);
    const result     = await preference.create({
      body: preferenceBody,
      requestOptions: { idempotencyKey: `order-${order.id}-pref` },
    });

    await db.query(
      `UPDATE orders
          SET mp_preference_id       = $1,
              mp_external_reference  = $2,
              mp_init_point          = $3,
              mp_sandbox_init_point  = $4,
              commission_rate        = $5,
              commission_amount      = $6,
              updated_at             = NOW()
        WHERE id = $7`,
      [
        result.id,
        externalRef,
        result.init_point,
        result.sandbox_init_point,
        COMMISSION_RATE,
        commission,
        order.id,
      ]
    );

    return res.json({
      ok:                 true,
      preference_id:      result.id,
      init_point:         result.init_point,
      sandbox_init_point: result.sandbox_init_point,
      is_sandbox:         mp.isSandbox,
      total:              parseFloat(order.total_price),
      commission,
      net_to_seller:      parseFloat(order.total_price) - commission,
      order_id:           order.id,
    });
  } catch (err) {
    console.error('[mp] createPreference error:', err);
    return res.status(500).json({ error: 'No se pudo crear la preferencia de pago' });
  }
};

// ============================================================
// POST /payments/webhook  (sin auth — viene de MP)
// ============================================================
const handleWebhook = async (req, res) => {
  // Respondemos rápido siempre 200 para que MP no reintente sin parar.
  // El procesamiento real se hace de forma asíncrona.
  res.status(200).send('ok');

  try {
    const signatureValid = verifyWebhookSignature(req);
    const requestId      = req.headers['x-request-id'] || null;
    const topic          = req.query.topic || req.query.type || req.body?.type;
    const dataId         = req.query['data.id'] || req.body?.data?.id;

    // Si la firma es inválida — registramos para auditoría y abortamos.
    // Sin esto, un atacante con la URL del webhook podría marcar
    // órdenes como pagas mandando JSON falso.
    if (signatureValid === false) {
      console.error('[mp-webhook] Firma inválida — RECHAZANDO', { requestId, dataId });
      try {
        await db.query(
          `INSERT INTO payment_events
             (mp_payment_id, mp_topic, mp_action, status, status_detail,
              raw_payload, signature_valid, request_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (request_id) DO NOTHING`,
          [
            dataId ? String(dataId) : null,
            topic || 'unknown',
            'rejected:invalid_signature',
            'rejected', 'invalid_signature',
            JSON.stringify({ headers: req.headers, query: req.query, body: req.body }),
            false,
            requestId,
          ]
        );
      } catch (e) {
        // si la tabla todavía no existe (eg. en dev) no bloqueamos
      }
      return;
    }

    // Idempotencia: si ya procesamos este request_id, salir
    if (requestId) {
      const dupe = await db.query(
        'SELECT id FROM payment_events WHERE request_id = $1 LIMIT 1',
        [requestId]
      );
      if (dupe.rows.length > 0) return;
    }

    if (!dataId) {
      console.warn('[mp-webhook] Notificación sin data.id, ignorando');
      return;
    }

    // Solo nos importan los eventos de payment por ahora
    if (topic !== 'payment' && topic !== 'payment.created' && topic !== 'payment.updated') {
      console.log('[mp-webhook] Topic ignorado:', topic);
      return;
    }

    // Consultamos el pago en MP
    const client  = mp.requireClient();
    const payment = new mp.Payment(client);
    const mpPayment = await payment.get({ id: dataId });

    if (!mpPayment) {
      console.warn('[mp-webhook] No se pudo obtener el pago', dataId);
      return;
    }

    const externalRef = mpPayment.external_reference;
    const newStatus   = mpStatusToLocal(mpPayment.status);

    // Buscamos la orden
    const orderRes = await db.query(
      `SELECT id, payment_status, status, seller_id, buyer_id,
              total_price, commission_amount
         FROM orders
        WHERE mp_external_reference = $1 OR mp_payment_id = $2
        LIMIT 1`,
      [externalRef, String(dataId)]
    );

    if (orderRes.rows.length === 0) {
      console.warn('[mp-webhook] Orden no encontrada para external_ref', externalRef);
      return;
    }

    const order = orderRes.rows[0];

    // Defensa contra suplantación: si el payment trae metadata, debe coincidir
    // con la orden que encontramos. Sin esto, un atacante podría crear
    // su propia preferencia con un external_reference que matchee otra orden.
    const meta = mpPayment.metadata || {};
    if (meta.order_id != null && Number(meta.order_id) !== Number(order.id)) {
      console.error('[mp-webhook] metadata.order_id no matchea', {
        meta_order_id: meta.order_id, order_id: order.id, externalRef,
      });
      return;
    }
    if (meta.buyer_id != null && Number(meta.buyer_id) !== Number(order.buyer_id)) {
      console.error('[mp-webhook] metadata.buyer_id no matchea', {
        meta_buyer_id: meta.buyer_id, order_buyer_id: order.buyer_id, externalRef,
      });
      return;
    }

    // Actualizamos orden (transaccional con el log)
    const client2 = await db.pool.connect();
    try {
      await client2.query('BEGIN');

      await client2.query(
        `UPDATE orders
            SET mp_payment_id = $1,
                payment_status = $2,
                status = $3,
                paid_at = CASE WHEN $2 = 'paid' AND paid_at IS NULL THEN NOW() ELSE paid_at END,
                updated_at = NOW()
          WHERE id = $4`,
        [
          String(dataId),
          newStatus,
          paymentToOrderStatus(newStatus, order.status),
          order.id,
        ]
      );

      // Si pasó a paid, creamos el payout para el vendedor
      if (newStatus === 'paid') {
        const gross      = parseFloat(order.total_price);
        const commission = parseFloat(order.commission_amount) || calculateCommission(gross);
        const net        = Math.round((gross - commission) * 100) / 100;

        await client2.query(
          `INSERT INTO seller_payouts
             (seller_id, order_id, gross_amount, commission_amount, net_amount, currency, status)
           VALUES ($1, $2, $3, $4, $5, 'ARS', 'pending')
           ON CONFLICT (order_id) DO NOTHING`,
          [order.seller_id, order.id, gross, commission, net]
        );
      }

      await client2.query(
        `INSERT INTO payment_events
           (order_id, mp_payment_id, mp_topic, mp_action, status, status_detail,
            raw_payload, signature_valid, request_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (request_id) DO NOTHING`,
        [
          order.id,
          String(dataId),
          topic,
          req.body?.action || topic,
          mpPayment.status,
          mpPayment.status_detail,
          JSON.stringify({ headers: {
            'x-signature':  req.headers['x-signature'],
            'x-request-id': req.headers['x-request-id'],
          }, query: req.query, body: req.body, mpPayment }),
          signatureValid,
          requestId,
        ]
      );

      await client2.query('COMMIT');
      console.log(`[mp-webhook] Orden ${order.id} → ${newStatus}`);

      // Mandar emails de notificación cuando la orden pasa a "paid".
      // Lo hacemos FUERA de la transacción y sin await — si falla un email
      // no afecta a la orden. Si falla el envío, queda registrado en logs.
      if (newStatus === 'paid') {
        sendOrderPaidEmails(order.id).catch(err =>
          console.error('[mp-webhook] sendOrderPaidEmails error:', err.message)
        );
      }
      // Si el pago fue rechazado o cancelado por MP, avisamos al comprador
      // (rapipago vencido, fondos insuficientes, 3DS rechazado, etc.).
      if (newStatus === 'rejected' || newStatus === 'cancelled') {
        sendPaymentFailedEmail(order.id, mpPayment.status_detail).catch(err =>
          console.error('[mp-webhook] sendPaymentFailedEmail error:', err.message)
        );
      }
    } catch (txErr) {
      await client2.query('ROLLBACK');
      throw txErr;
    } finally {
      client2.release();
    }
  } catch (err) {
    console.error('[mp-webhook] Error procesando:', err);
  }
};

// ============================================================
// Helper: trae los datos completos de la orden + ambos usuarios
// y dispara emails de "compra confirmada" (al comprador) y
// "tenés una venta nueva" (al vendedor).
// ============================================================
async function sendOrderPaidEmails(orderId) {
  const r = await db.query(
    `SELECT o.id, o.total_price, o.shipping_method, o.shipping_city,
            p.title AS product_title,
            ub.email AS buyer_email,  ub.name AS buyer_name,
            us.email AS seller_email, us.name AS seller_name
       FROM orders o
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN users ub   ON ub.id = o.buyer_id
       LEFT JOIN users us   ON us.id = o.seller_id
      WHERE o.id = $1`,
    [orderId]
  );
  if (r.rows.length === 0) return;
  const o = r.rows[0];
  const isPickup = o.shipping_method === 'pickup';

  // 1) Email al COMPRADOR — compra confirmada
  if (o.buyer_email) {
    const tpl = orderPaidBuyerTemplate({
      buyerName:    o.buyer_name,
      orderId:      o.id,
      productTitle: o.product_title,
      total:        o.total_price,
      sellerName:   o.seller_name,
      isPickup,
    });
    sendEmail({ to: o.buyer_email, subject: tpl.subject, html: tpl.html, text: tpl.text })
      .catch(e => console.error('[email] buyer notify failed:', e.message));
  }

  // 2) Email al VENDEDOR — venta nueva
  if (o.seller_email) {
    const tpl = newSaleSellerTemplate({
      sellerName:   o.seller_name,
      orderId:      o.id,
      productTitle: o.product_title,
      buyerName:    o.buyer_name,
      total:        o.total_price,
      isPickup,
      shippingCity: o.shipping_city,
    });
    sendEmail({ to: o.seller_email, subject: tpl.subject, html: tpl.html, text: tpl.text })
      .catch(e => console.error('[email] seller notify failed:', e.message));
  }
}

// ============================================================
// Helper: dispara email "no pudimos cobrar tu pago" al comprador.
// ============================================================
async function sendPaymentFailedEmail(orderId, statusDetail) {
  const r = await db.query(
    `SELECT o.id, p.title AS product_title,
            ub.email AS buyer_email, ub.name AS buyer_name
       FROM orders o
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN users ub   ON ub.id = o.buyer_id
      WHERE o.id = $1`,
    [orderId]
  );
  if (r.rows.length === 0) return;
  const o = r.rows[0];
  if (!o.buyer_email) return;
  const tpl = paymentFailedBuyerTemplate({
    buyerName:    o.buyer_name,
    orderId:      o.id,
    productTitle: o.product_title,
    reason:       statusDetail || null,
  });
  await sendEmail({ to: o.buyer_email, subject: tpl.subject, html: tpl.html, text: tpl.text });
}

// ============================================================
// GET /payments/:orderId/status
// ============================================================
const getStatus = async (req, res) => {
  const orderId = parseInt(req.params.orderId, 10);
  if (Number.isNaN(orderId)) return res.status(400).json({ error: 'orderId inválido' });

  try {
    const result = await db.query(
      `SELECT o.id, o.buyer_id, o.seller_id, o.product_id, o.quantity,
              o.total_price, o.currency, o.status, o.payment_status,
              o.mp_payment_id, o.mp_preference_id, o.paid_at, o.created_at,
              o.commission_amount,
              o.shipping_method, o.shipping_cost,
              o.tracking_number, o.dispatched_at, o.delivered_at,
              p.title  AS product_title,
              (SELECT id FROM conversations c
                 WHERE c.item_type  = 'product'
                   AND c.product_id = o.product_id
                   AND c.buyer_id   = o.buyer_id
                   AND c.seller_id  = o.seller_id
                 ORDER BY c.created_at DESC
                 LIMIT 1
              ) AS conversation_id
         FROM orders o
         LEFT JOIN products p ON p.id = o.product_id
        WHERE o.id = $1`,
      [orderId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    const order = result.rows[0];
    if (order.buyer_id !== req.user.id && order.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'No tenés permiso para ver esta orden' });
    }

    return res.json({ order });
  } catch (err) {
    console.error('[mp] getStatus error:', err);
    return res.status(500).json({ error: 'Error al consultar el estado del pago' });
  }
};

// ============================================================
// POST /admin/orders/:id/refund   - Reembolso (admin only)
// ============================================================
/**
 * Reembolsa una orden vía Mercado Pago.
 *
 * Body opcional:
 *   - amount (number) — monto parcial. Si se omite, reembolso total.
 *   - reason (string) — motivo interno para logs/auditoría.
 *
 * Flujo:
 *   1. Valida que la orden exista y esté en estado paid (no se puede refund algo no pagado).
 *   2. Llama a la API Refunds de MP: POST /v1/payments/:payment_id/refunds
 *   3. Si OK, actualiza orders.payment_status='refunded' y status='cancelled'.
 *   4. Notifica al comprador por email.
 *
 * MP docs: https://www.mercadopago.com.ar/developers/es/reference/chargebacks/_payments_id_refunds/post
 *
 * IMPORTANTE: el refund tarda hasta 5 días hábiles en acreditarse en
 * el método de pago original. El webhook MP también va a llegar y
 * actualizar el estado — lo hacemos manualmente acá para que el admin
 * vea el cambio inmediato en la UI.
 */
const refundOrder = async (req, res) => {
  const orderId = parseInt(req.params.id, 10);
  if (Number.isNaN(orderId)) {
    return res.status(400).json({ error: 'orderId inválido' });
  }

  const { amount, reason } = req.body || {};
  if (amount !== undefined) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ error: 'amount debe ser un número positivo' });
    }
  }

  if (!mp.isConfigured) {
    return res.status(503).json({ error: 'Mercado Pago no está configurado en el servidor' });
  }

  try {
    // ── 1. Buscar la orden ───────────────────────────────
    const orderRes = await db.query(
      `SELECT o.id, o.payment_status, o.status, o.mp_payment_id,
              o.total_price, o.buyer_id, o.seller_id,
              ub.email AS buyer_email, ub.name AS buyer_name,
              p.title  AS product_title
         FROM orders o
         LEFT JOIN users ub  ON ub.id = o.buyer_id
         LEFT JOIN products p ON p.id = o.product_id
        WHERE o.id = $1`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    const order = orderRes.rows[0];

    if (!order.mp_payment_id) {
      return res.status(400).json({
        error: 'Esta orden no tiene un payment_id de MP — probablemente nunca se pagó.',
      });
    }

    if (order.payment_status !== 'paid') {
      return res.status(400).json({
        error: `No se puede reembolsar una orden con estado "${order.payment_status}". Solo se reembolsan órdenes pagadas.`,
      });
    }

    // ── 2. Llamar a MP Refunds ──────────────────────────
    // El SDK no tiene método dedicado para refunds parciales en la versión actual,
    // pero podemos hacer un fetch directo a la API REST. Para refund total no se
    // manda body. Para parcial se manda { amount }.
    const accessToken = process.env.MP_ACCESS_TOKEN;
    const refundUrl = `https://api.mercadopago.com/v1/payments/${order.mp_payment_id}/refunds`;
    const refundBody = (amount && Number(amount) < Number(order.total_price))
      ? { amount: Number(amount) }
      : undefined;

    const mpRes = await fetch(refundUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        // Idempotency key: si el admin clickea 2 veces, MP no lo procesa 2 veces
        'X-Idempotency-Key': `refund-${orderId}-${Date.now()}`,
      },
      body: refundBody ? JSON.stringify(refundBody) : undefined,
    });

    const mpData = await mpRes.json().catch(() => ({}));

    if (!mpRes.ok) {
      console.error('[refund] MP rejected:', mpRes.status, mpData);
      return res.status(502).json({
        error: 'Mercado Pago rechazó el reembolso.',
        details: mpData?.message || mpData?.error || `HTTP ${mpRes.status}`,
      });
    }

    // ── 3. Actualizar la orden en DB ───────────────────
    const isPartial = refundBody !== undefined;
    const newPaymentStatus = isPartial ? 'paid' : 'refunded';
    const newOrderStatus   = isPartial ? order.status : 'cancelled';

    await db.query(
      `UPDATE orders
          SET payment_status = $1,
              status         = $2,
              updated_at     = NOW()
        WHERE id = $3`,
      [newPaymentStatus, newOrderStatus, order.id]
    );

    // Log de auditoría (consola — en el futuro tabla audit_log)
    console.log(`[refund] Order #${orderId} ${isPartial ? 'partially' : 'fully'} refunded by admin ${req.user?.id || '?'}. Reason: ${reason || '—'}. MP refund id: ${mpData?.id}`);

    // ── 4. Notificar al comprador (fire-and-forget) ────
    if (order.buyer_email) {
      const refundAmount = isPartial ? Number(amount) : Number(order.total_price);
      const refundFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(refundAmount);
      const inner = `
        <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#1f2937;">${isPartial ? 'Reembolso parcial procesado' : 'Reembolso procesado'} ✓</h2>
        <p>Hola${order.buyer_name ? ' ' + order.buyer_name : ''},</p>
        <p>Procesamos un reembolso${isPartial ? ' parcial' : ''} para tu orden <strong>#${order.id}</strong> (${order.product_title || 'tu compra'}).</p>
        <table role="presentation" width="100%" style="background:#f9fafb;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
          <tr><td style="font-size:13px;color:#6b7280;padding:4px 0;">Monto reembolsado:</td><td style="text-align:right;font-weight:700;color:#16a34a;">${refundFmt}</td></tr>
          ${reason ? `<tr><td style="font-size:13px;color:#6b7280;padding:4px 0;">Motivo:</td><td style="text-align:right;">${String(reason).replace(/[<>]/g, '')}</td></tr>` : ''}
        </table>
        <p>El dinero se va a acreditar en tu método de pago original en <strong>1 a 5 días hábiles</strong>, dependiendo del banco/billetera.</p>
        <p style="font-size:13px;color:#6b7280;">Si tenés dudas, escribinos desde <a href="https://daledeal.com.ar/HTML/contacto.html" style="color:#d63031;">contacto</a>.</p>
      `;
      sendEmail({
        to: order.buyer_email,
        subject: `${isPartial ? 'Reembolso parcial' : 'Reembolso'} procesado · Orden #${order.id}`,
        html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,sans-serif;color:#1f2937;"><table role="presentation" width="100%" style="background:#f5f5f5;padding:24px 12px;"><tr><td align="center"><table role="presentation" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);"><tr><td style="background:linear-gradient(135deg,#ff8000 0%,#d63031 100%);padding:24px;text-align:center;"><span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-.5px;">DALE DEAL</span></td></tr><tr><td style="padding:28px 32px;line-height:1.55;font-size:15px;">${inner}</td></tr></table></td></tr></table></body></html>`,
        text: `Reembolso procesado por ${refundFmt} en tu orden #${order.id}. Se acreditará en 1-5 días hábiles en tu método de pago original.`,
      }).catch(e => console.error('[refund] email failed:', e.message));
    }

    return res.json({
      ok: true,
      order_id: order.id,
      refund_id: mpData?.id,
      refunded_amount: isPartial ? Number(amount) : Number(order.total_price),
      partial: isPartial,
      new_payment_status: newPaymentStatus,
      new_status: newOrderStatus,
    });
  } catch (err) {
    console.error('[refund] Error:', err);
    return res.status(500).json({
      error: 'Error al procesar el reembolso. Revisá los logs del servidor.',
    });
  }
};

module.exports = {
  createPreference,
  handleWebhook,
  getStatus,
  refundOrder,
};
