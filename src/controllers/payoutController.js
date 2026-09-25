/**
 * Escrow / Compra Protegida — liberación de pagos al vendedor.
 *
 * La plata del comprador queda retenida (release_status='retained') desde el
 * pago. Se puede liberar cuando: el comprador confirmó recepción, O pasaron
 * RELEASE_DAYS desde la entrega sin reclamo. El payout es manual (MP→MP) en
 * el MVP: el admin transfiere y acá queda el registro con el comprobante.
 *
 * Tolerante a migration 015 sin aplicar (42P01/42703 → respuesta suave).
 */
const db = require('../config/database');
const { sendEmail, payoutReleasedSellerTemplate } = require('../services/email');
const { describePayoutAccount } = require('../services/payoutAccount');

const RELEASE_DAYS = 7;
const migPending = (err) => err.code === '42P01' || err.code === '42703';
const clip = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Condición SQL de "liberable": confirmó el comprador o venció el plazo.
const RELEASABLE_SQL = `(o.buyer_confirmed_at IS NOT NULL
  OR (o.delivered_at IS NOT NULL AND o.delivered_at < NOW() - INTERVAL '${RELEASE_DAYS} days'))`;

// Datos de cobro del vendedor (migration 017) para el modal de liberación.
const SELLER_PAYOUT_COLS = `us.payout_account AS seller_payout_account,
              us.payout_holder AS seller_payout_holder,
              us.payout_updated_at AS seller_payout_updated_at,`;

// Corre la query con las columnas de la 017; si todavía no existen (42703),
// la repite sin ellas.
async function queryWithPayoutCols(buildSql, params) {
  try {
    return await db.query(buildSql(true), params);
  } catch (err) {
    if (err.code !== '42703') throw err;
    return db.query(buildSql(false), params);
  }
}

// GET /admin/payouts/pending — cola de retenciones (liberables primero)
async function listReleasable(req, res) {
  try {
    const r = await queryWithPayoutCols(withPayout =>
      `SELECT o.id, o.total_price, o.commission_amount, o.currency, o.status,
              o.paid_at, o.delivered_at, o.buyer_confirmed_at, o.release_status,
              o.delivered_source, o.shipping_method,
              (o.total_price - COALESCE(o.commission_amount, 0)) AS net_amount,
              ${RELEASABLE_SQL} AS releasable,
              p.title AS product_title,
              us.id AS seller_id, us.name AS seller_name, us.email AS seller_email,
              ${withPayout ? SELLER_PAYOUT_COLS : ''}
              ub.name AS buyer_name
         FROM orders o
         LEFT JOIN products p ON p.id = o.product_id
         JOIN users us ON us.id = o.seller_id
         JOIN users ub ON ub.id = o.buyer_id
        WHERE o.payment_status = 'paid'
          AND o.release_status IN ('retained', 'held')
        ORDER BY releasable DESC, o.paid_at ASC NULLS LAST`
    );
    return res.json({ total: r.rows.length, orders: r.rows });
  } catch (err) {
    if (migPending(err)) return res.json({ total: 0, orders: [] });
    console.error('[payouts] list:', err.message);
    return res.status(500).json({ error: 'Error al listar retenciones.' });
  }
}

// GET /admin/payouts/released — historial de liberaciones registradas (más nuevas primero)
async function listReleased(req, res) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const r = await queryWithPayoutCols(withPayout =>
      `SELECT p.id AS payout_id, p.order_id, p.gross_amount, p.commission_amount, p.net_amount,
              p.currency, p.method, p.reference, p.note, p.created_at,
              ${withPayout ? 'p.destination,' : ''}
              o.status, o.delivered_at, o.buyer_confirmed_at, o.released_at, o.delivered_source,
              pr.title AS product_title,
              us.id AS seller_id, us.name AS seller_name, us.email AS seller_email,
              ub.name AS buyer_name,
              ua.name AS admin_name
         FROM payouts p
         JOIN orders o ON o.id = p.order_id
         LEFT JOIN products pr ON pr.id = o.product_id
         LEFT JOIN users us ON us.id = p.seller_id
         LEFT JOIN users ub ON ub.id = o.buyer_id
         LEFT JOIN users ua ON ua.id = p.created_by
        ORDER BY p.created_at DESC
        LIMIT $1`,
      [limit]
    );
    return res.json({ total: r.rows.length, payouts: r.rows });
  } catch (err) {
    if (migPending(err)) return res.json({ total: 0, payouts: [] });
    console.error('[payouts] released:', err.message);
    return res.status(500).json({ error: 'Error al listar liberaciones.' });
  }
}

// POST /admin/orders/:id/release — registrar la liberación (transacción)
// Body: { reference?: string (nro operación MP), note?: string, force?: bool }
// force=true saltea la condición de plazo/confirmación (exige note).
async function releaseOrder(req, res) {
  const client = await db.pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido.' });
    const reference = clip(req.body?.reference);
    const note = clip(req.body?.note, 500);
    const force = req.body?.force === true;
    if (force && !note) {
      return res.status(400).json({ error: 'Liberar con force requiere una nota (motivo).' });
    }

    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT o.id, o.seller_id, o.total_price, o.commission_amount, o.currency,
              o.payment_status, o.release_status, ${RELEASABLE_SQL} AS releasable
         FROM orders o WHERE o.id = $1 FOR UPDATE`,
      [id]
    );
    if (cur.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orden no encontrada.' });
    }
    const o = cur.rows[0];
    if (o.payment_status !== 'paid') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La orden no está paga (o fue reembolsada).' });
    }
    if (o.release_status === 'released') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Esta orden ya fue liberada.' });
    }
    if (o.release_status === 'held' && !force) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La orden está frenada por reclamo. Resolvé el reclamo o usá force con nota.' });
    }
    if (!o.releasable && !force) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Todavía no es liberable: falta confirmación del comprador o que pasen ${RELEASE_DAYS} días de la entrega.` });
    }

    const gross = parseFloat(o.total_price);
    const commission = parseFloat(o.commission_amount || 0);
    const net = Math.round((gross - commission) * 100) / 100;

    const p = await client.query(
      `INSERT INTO payouts (order_id, seller_id, gross_amount, commission_amount, net_amount, currency, reference, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [id, o.seller_id, gross, commission, net, o.currency || 'ARS', reference || null, note || null, req.user.id]
    );
    await client.query(
      `UPDATE orders SET release_status = 'released', released_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id]
    );
    await client.query('COMMIT');
    notifySellerPayout(id, p.rows[0]).catch(e => console.error('[email] payout notify failed:', e.message));
    return res.status(201).json({ ok: true, payout: p.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'Esta orden ya tiene un payout registrado.' });
    if (migPending(err)) return res.status(503).json({ error: 'El circuito de liberación todavía no está disponible.' });
    console.error('[payouts] release:', err.message);
    return res.status(500).json({ error: 'No pudimos registrar la liberación.' });
  } finally {
    client.release();
  }
}

// Aviso al vendedor de que se liberó su pago. Nunca frena la liberación: si
// el mail falla, el payout ya quedó registrado y se loguea el error.
async function notifySellerPayout(orderId, payout) {
  const r = await queryWithPayoutCols(withPayout =>
    `SELECT us.email AS seller_email, us.name AS seller_name, pr.title AS product_title
            ${withPayout ? ', us.payout_account, us.payout_holder' : ''}
       FROM orders o
       JOIN users us ON us.id = o.seller_id
       LEFT JOIN products pr ON pr.id = o.product_id
      WHERE o.id = $1`,
    [orderId]
  );
  const row = r.rows[0];
  if (!row) return;

  // Auditoría: a qué cuenta de cobro se liberó (por si después la cambia).
  const d = describePayoutAccount(row.payout_account);
  const destination = d ? `${d.label}${row.payout_holder ? ' · ' + row.payout_holder : ''}`.slice(0, 160) : null;
  if (destination) {
    await db.query('UPDATE payouts SET destination = $1 WHERE id = $2 AND destination IS NULL', [destination, payout.id])
      .catch(e => console.error('[payouts] destination:', e.message));
  }

  if (!row.seller_email) return;
  const tpl = payoutReleasedSellerTemplate({
    sellerName:   row.seller_name,
    orderId,
    productTitle: row.product_title,
    gross:        payout.gross_amount,
    commission:   payout.commission_amount,
    net:          payout.net_amount,
    reference:    payout.reference,
    destination,
  });
  await sendEmail({ to: row.seller_email, subject: tpl.subject, html: tpl.html, text: tpl.text });
}

// POST /admin/orders/:id/hold — frenar/desfrenar por reclamo
// Body: { hold: true|false, note?: string }
async function holdOrder(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido.' });
    const hold = req.body?.hold === true;
    const target = hold ? 'held' : 'retained';
    const from = hold ? 'retained' : 'held';
    const r = await db.query(
      `UPDATE orders SET release_status = $1, updated_at = NOW()
        WHERE id = $2 AND release_status = $3
        RETURNING id, release_status`,
      [target, id, from]
    );
    if (r.rows.length === 0) {
      return res.status(409).json({ error: `La orden no está en estado '${from}' (o no existe).` });
    }
    return res.json({ ok: true, ...r.rows[0] });
  } catch (err) {
    if (migPending(err)) return res.status(503).json({ error: 'El circuito de liberación todavía no está disponible.' });
    console.error('[payouts] hold:', err.message);
    return res.status(500).json({ error: 'No pudimos actualizar la retención.' });
  }
}

module.exports = { listReleasable, listReleased, releaseOrder, holdOrder, RELEASE_DAYS, RELEASABLE_SQL };
