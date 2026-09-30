/**
 * Vencimiento de órdenes sin pagar.
 *
 * createOrder descuenta el stock al crear la orden (antes del pago). Si el
 * comprador abandona el checkout de MP, la orden queda 'pending' para siempre
 * y, con stock 1, el producto pasa a 'sold' y desaparece del catálogo.
 * Con PENDING_ORDER_EXPIRE_HOURS cargada (72 recomendado: cubre los 3 días que
 * MP le da a un ticket de Rapipago/Pago Fácil), cada 30 minutos cancelamos las
 * órdenes sin pagar más viejas que eso y devolvemos el stock.
 *
 * Si igual entra un pago después (ticket pagado tarde), el webhook deja la
 * orden cancelada con una alerta para reembolsar (paid_after_cancel).
 */
const db = require('../config/database');

const EXPIRE_HOURS = Math.max(1, parseInt(process.env.PENDING_ORDER_EXPIRE_HOURS || '72', 10) || 72);
const EVERY_MS = 30 * 60 * 1000;

// Pagos con los que la orden todavía NO tiene plata en juego. 'in_process'
// (MP revisando el pago) y 'authorized' quedan afuera: pueden aprobarse.
const UNPAID = ['pending', 'rejected', 'cancelled'];

async function expireStalePendingOrders() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const expired = await client.query(
      `UPDATE orders
          SET status = 'cancelled', updated_at = NOW()
        WHERE status = 'pending'
          AND COALESCE(payment_status, 'pending') = ANY($1)
          AND created_at < NOW() - make_interval(hours => $2)
        RETURNING id, product_id, quantity`,
      [UNPAID, EXPIRE_HOURS]
    );
    for (const o of expired.rows) {
      if (!o.product_id) continue;
      await client.query(
        `UPDATE products
            SET stock  = stock + $1,
                status = CASE WHEN status = 'sold' THEN 'active' ELSE status END,
                updated_at = NOW()
          WHERE id = $2`,
        [o.quantity, o.product_id]
      );
    }
    await client.query('COMMIT');
    if (expired.rowCount > 0) {
      console.log(`[orders] ${expired.rowCount} órdenes sin pagar vencidas (${EXPIRE_HOURS} h): stock devuelto`,
        expired.rows.map(o => o.id));
    }
    return expired.rowCount;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[orders] Error venciendo órdenes sin pagar:', err.message);
    return 0;
  } finally {
    client.release();
  }
}

function startOrderExpiry() {
  // Se activa cargando PENDING_ORDER_EXPIRE_HOURS: la primera pasada en prod
  // cancela órdenes viejas sin pagar, y eso lo decide el equipo, no un deploy.
  if (!process.env.PENDING_ORDER_EXPIRE_HOURS) {
    console.log('[orders] Vencimiento de órdenes sin pagar APAGADO (PENDING_ORDER_EXPIRE_HOURS=72 lo activa)');
    return;
  }
  // Primera pasada al minuto de arrancar (no compite con el boot) y después cada 30 min.
  setTimeout(expireStalePendingOrders, 60 * 1000).unref?.();
  setInterval(expireStalePendingOrders, EVERY_MS).unref?.();
}

module.exports = { expireStalePendingOrders, startOrderExpiry, EXPIRE_HOURS };
