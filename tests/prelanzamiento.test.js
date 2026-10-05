/**
 * Tests de los arreglos de la revisión pre-lanzamiento:
 *  - Pagos: reglas de cada notificación de MP (decidePaymentTransition), el
 *    webhook (reintentos, firma) y la reconciliación al volver del checkout.
 *  - Órdenes: quién cancela y cuándo, estados que no vuelven atrás, retiro en
 *    persona que se puede cerrar.
 *  - Auth: una cuenta suspendida no sigue usando su token.
 *  - Productos: borrado lógico y bajas del admin que el vendedor no revierte.
 *  - Reembolsos: no se reembolsa una orden ya liberada al vendedor.
 * La base y Mercado Pago van mockeados.
 */
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  pool:  { connect: jest.fn() },
}));
jest.mock('../src/config/mercadopago', () => ({
  isConfigured:  true,
  isSandbox:     false,
  requireClient: jest.fn(() => ({})),
  Payment:       jest.fn(),
  Preference:    jest.fn(),
}));
jest.mock('../src/services/email', () => {
  const actual = jest.requireActual('../src/services/email');
  return { ...actual, sendEmail: jest.fn() };
});

const crypto  = require('crypto');
const request = require('supertest');
const jwt     = require('jsonwebtoken');
const db      = require('../src/config/database');
const mp      = require('../src/config/mercadopago');
const email   = require('../src/services/email');
const app     = require('../src/index');
const { decidePaymentTransition } = require('../src/controllers/paymentsController');
const { _resetStoreForTests } = require('../src/middleware/rateLimiter');

const tokenFor = (id, role = 'user') =>
  jwt.sign({ id, email: `u${id}@test.com`, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
const AUTH_SQL = /SELECT is_active FROM users WHERE id/;

// Cliente de transacción falso: responde según el SQL y guarda lo que corrió.
function fakeClient(handler) {
  const sqls = [];
  const client = {
    sqls,
    query: jest.fn(async (sql, params) => {
      sqls.push({ sql, params });
      const r = handler ? await handler(sql, params) : undefined;
      return r || { rowCount: 0, rows: [] };
    }),
    release: jest.fn(),
  };
  db.pool.connect.mockResolvedValue(client);
  return client;
}

const mpGet = jest.fn();
const savedSecret = process.env.MP_WEBHOOK_SECRET;

beforeEach(() => {
  _resetStoreForTests();
  db.query.mockReset();
  db.query.mockResolvedValue({ rowCount: 0, rows: [] });
  db.pool.connect.mockReset();
  email.sendEmail.mockReset();
  email.sendEmail.mockResolvedValue({ ok: true });
  mpGet.mockReset();
  mp.Payment.mockImplementation(() => ({ get: mpGet }));
  delete process.env.MP_WEBHOOK_SECRET;
});
afterAll(() => {
  if (savedSecret === undefined) delete process.env.MP_WEBHOOK_SECRET;
  else process.env.MP_WEBHOOK_SECRET = savedSecret;
});

// ------------------------------------------------------------
describe('decidePaymentTransition', () => {
  const order = (over = {}) => ({
    status: 'pending', payment_status: 'pending', mp_payment_id: null, release_status: 'retained', ...over,
  });

  test('pago aprobado de una orden pendiente → paga, confirmada y con mails', () => {
    expect(decidePaymentTransition(order(), '111', 'paid'))
      .toMatchObject({ apply: true, payment_status: 'paid', status: 'confirmed', becamePaid: true });
  });

  test('aprobado repetido de una orden ya despachada → no la devuelve a confirmed ni repite mails', () => {
    const d = decidePaymentTransition(order({ status: 'shipped', payment_status: 'paid', mp_payment_id: '111' }), '111', 'paid');
    expect(d.apply).toBe(false);
    expect(d.becamePaid).toBeFalsy();
  });

  test('rechazo tardío de OTRO intento no pisa una orden paga', () => {
    expect(decidePaymentTransition(order({ status: 'confirmed', payment_status: 'paid', mp_payment_id: '111' }), '110', 'rejected'))
      .toEqual({ apply: false });
  });

  test('segundo pago aprobado para una orden ya paga → alerta de doble cobro, sin tocar la orden', () => {
    expect(decidePaymentTransition(order({ status: 'confirmed', payment_status: 'paid', mp_payment_id: '111' }), '112', 'paid'))
      .toEqual({ apply: false, alert: 'double_payment' });
  });

  test('rechazo → la orden sigue pendiente (se puede reintentar) y se avisa una vez', () => {
    const first = decidePaymentTransition(order(), '110', 'rejected');
    expect(first).toMatchObject({ apply: true, payment_status: 'rejected', status: 'pending', becameFailed: true });
    const second = decidePaymentTransition(order({ payment_status: 'rejected', mp_payment_id: '110' }), '113', 'rejected');
    expect(second).toMatchObject({ apply: true, status: 'pending', becameFailed: false });
  });

  test('pago aprobado de una orden cancelada → queda paga pero cancelada, con alerta para reembolsar', () => {
    expect(decidePaymentTransition(order({ status: 'cancelled' }), '111', 'paid'))
      .toMatchObject({ apply: true, payment_status: 'paid', status: 'cancelled', alert: 'paid_after_cancel' });
  });

  test('reembolso de una orden retenida → cancelada y release_status refunded', () => {
    expect(decidePaymentTransition(order({ status: 'confirmed', payment_status: 'paid', mp_payment_id: '111' }), '111', 'refunded'))
      .toMatchObject({ apply: true, payment_status: 'refunded', status: 'cancelled', release_status: 'refunded' });
  });

  test('reembolso de una orden ya liberada → alerta y no marca refunded', () => {
    const d = decidePaymentTransition(order({ status: 'delivered', payment_status: 'paid', mp_payment_id: '111', release_status: 'released' }), '111', 'refunded');
    expect(d).toMatchObject({ apply: true, alert: 'refund_after_release' });
    expect(d.release_status).toBeUndefined();
  });

  test('reembolso repetido → nada', () => {
    expect(decidePaymentTransition(order({ status: 'cancelled', payment_status: 'refunded', mp_payment_id: '111' }), '111', 'refunded'))
      .toEqual({ apply: false });
  });
});

// ------------------------------------------------------------
describe('POST /payments/webhook', () => {
  const mpPayment = (over = {}) => ({
    id: 111, status: 'approved', status_detail: 'accredited',
    external_reference: 'daledeal-order-42-1', metadata: { order_id: 42, buyer_id: 7 }, ...over,
  });
  const wireOrder = (current = {}) => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM orders\s+WHERE mp_external_reference/i.test(sql)) return { rowCount: 1, rows: [{ id: 42, buyer_id: 7 }] };
      return { rowCount: 0, rows: [] };
    });
    return fakeClient(async (sql) => {
      if (/FOR UPDATE/i.test(sql)) {
        return { rowCount: 1, rows: [{ id: 42, status: 'pending', payment_status: 'pending', mp_payment_id: null,
          release_status: 'retained', seller_id: 9, total_price: '10000.00', commission_amount: '500.00', ...current }] };
      }
    });
  };
  const sign = (dataId, requestId, secret) => {
    const ts = '1700000000';
    const v1 = crypto.createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
    return `ts=${ts},v1=${v1}`;
  };

  test('pago aprobado → orden paga/confirmada, payout, evento y mails', async () => {
    mpGet.mockResolvedValue(mpPayment());
    const client = wireOrder();
    const res = await request(app).post('/payments/webhook?type=payment&data.id=111')
      .set('x-request-id', 'req-1').send({ type: 'payment', action: 'payment.updated', data: { id: '111' } });
    expect(res.status).toBe(200);
    const upd = client.sqls.find(q => /UPDATE orders/i.test(q.sql));
    expect(upd.params.slice(0, 3)).toEqual(['111', 'paid', 'confirmed']);
    expect(client.sqls.some(q => /INSERT INTO seller_payouts/i.test(q.sql))).toBe(true);
    expect(client.sqls.some(q => /INSERT INTO payment_events/i.test(q.sql))).toBe(true);
    expect(client.sqls.map(q => q.sql)).toContain('COMMIT');
  });

  test('si MP o la base fallan → 500 para que MP reintente (antes se perdía el pago)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mpGet.mockRejectedValue({ status: 500, message: 'internal_error' });
    const res = await request(app).post('/payments/webhook?type=payment&data.id=111')
      .set('x-request-id', 'req-2').send({ type: 'payment', data: { id: '111' } });
    spy.mockRestore();
    expect(res.status).toBe(500);
  });

  test('pago que MP no encuentra (notificación de prueba del panel) → 200 sin tocar nada', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mpGet.mockRejectedValue({ status: 404, message: 'Payment not found' });
    const res = await request(app).post('/payments/webhook?type=payment&data.id=123456')
      .set('x-request-id', 'req-3').send({ type: 'payment', data: { id: '123456' } });
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  test('firma inválida → 401 (MP reintenta) y se registra sin request_id', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.MP_WEBHOOK_SECRET = 'secreto-bueno';
    const res = await request(app).post('/payments/webhook?type=payment&data.id=111')
      .set('x-request-id', 'req-4').set('x-signature', sign('111', 'req-4', 'secreto-malo'))
      .send({ type: 'payment', data: { id: '111' } });
    spy.mockRestore();
    expect(res.status).toBe(401);
    expect(mpGet).not.toHaveBeenCalled();
    const log = db.query.mock.calls.find(([sql]) => /INSERT INTO payment_events/i.test(sql));
    expect(log[0]).toMatch(/VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, NULL\)/);
  });

  test('firma válida → se procesa', async () => {
    process.env.MP_WEBHOOK_SECRET = 'secreto-bueno';
    mpGet.mockResolvedValue(mpPayment());
    wireOrder();
    const res = await request(app).post('/payments/webhook?type=payment&data.id=111')
      .set('x-request-id', 'req-5').set('x-signature', sign('111', 'req-5', 'secreto-bueno'))
      .send({ type: 'payment', data: { id: '111' } });
    expect(res.status).toBe(200);
    expect(mpGet).toHaveBeenCalledWith({ id: '111' });
  });

  test('aviso en el formato viejo de MP (sin data.id) → 200, sin contarlo como firma inválida', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env.MP_WEBHOOK_SECRET = 'secreto-bueno';
    const res = await request(app).post('/payments/webhook?topic=merchant_order&id=987')
      .set('x-request-id', 'req-7').set('x-signature', 'ts=1700000000,v1=abc123')
      .send({ resource: 'https://api.mercadolibre.com/merchant_orders/987', topic: 'merchant_order' });
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(mpGet).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO payment_events/i.test(sql))).toBe(false);
  });

  test('aprobado repetido sobre una orden despachada → no cambia la orden ni reenvía mails', async () => {
    mpGet.mockResolvedValue(mpPayment());
    const client = wireOrder({ status: 'shipped', payment_status: 'paid', mp_payment_id: '111' });
    const res = await request(app).post('/payments/webhook?type=payment&data.id=111')
      .set('x-request-id', 'req-6').send({ type: 'payment', data: { id: '111' } });
    await flush();
    expect(res.status).toBe(200);
    expect(client.sqls.some(q => /UPDATE orders/i.test(q.sql))).toBe(false);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
describe('Mails del circuito de pago', () => {
  test('pago rechazado: el motivo va en palabras, nunca el código de MP', () => {
    const t = email.paymentFailedBuyerTemplate({ buyerName: 'Ana', orderId: 7, productTitle: 'Mate', reason: 'cc_rejected_high_risk' });
    expect(t.html).toContain('rechazó el pago por seguridad');
    expect(t.text).toContain('rechazó el pago por seguridad');
    expect(t.html + t.text).not.toContain('cc_rejected');

    const desconocido = email.paymentFailedBuyerTemplate({ orderId: 7, reason: 'cc_rejected_algo_nuevo' });
    expect(desconocido.html + desconocido.text).not.toContain('cc_rejected');
    expect(desconocido.text).toContain('No pudimos cobrar tu pago de la orden #7.');
  });

  test('venta nueva: el asunto lleva el título tal cual, sin entidades HTML', () => {
    const t = email.newSaleSellerTemplate({ orderId: 1, productTitle: 'Mate &amp; bombilla 14&quot;', buyerName: 'Y', total: 100 });
    expect(t.subject).toBe('🎉 Vendiste "Mate & bombilla 14"" — Orden #1');
    expect(email.newSaleSellerTemplate({ orderId: 1, buyerName: 'Y', total: 100 }).subject).toBe('🎉 Vendiste "un producto" — Orden #1');
  });
});

// ------------------------------------------------------------
describe('GET /payments/:orderId/status → reconciliación al volver de MP', () => {
  const statusRow = (over = {}) => ({
    id: 42, buyer_id: 7, seller_id: 9, status: 'pending', payment_status: 'pending',
    mp_external_reference: 'daledeal-order-42-1', ...over,
  });

  test('vuelve con payment_id y MP dice aprobado → la orden queda paga aunque el webhook no haya llegado', async () => {
    let paid = false;
    db.query.mockImplementation(async (sql) => {
      if (AUTH_SQL.test(sql)) return { rowCount: 1, rows: [{ is_active: true }] };
      if (/AS conversation_id/i.test(sql)) return { rowCount: 1, rows: [statusRow(paid ? { status: 'confirmed', payment_status: 'paid' } : {})] };
      if (/FROM orders\s+WHERE mp_external_reference/i.test(sql)) return { rowCount: 1, rows: [{ id: 42, buyer_id: 7 }] };
      return { rowCount: 0, rows: [] };
    });
    fakeClient(async (sql) => {
      if (/FOR UPDATE/i.test(sql)) return { rowCount: 1, rows: [{ id: 42, status: 'pending', payment_status: 'pending', mp_payment_id: null, release_status: 'retained', seller_id: 9, total_price: '100', commission_amount: '5' }] };
      if (/UPDATE orders/i.test(sql)) { paid = true; }
    });
    mpGet.mockResolvedValue({ id: 555, status: 'approved', status_detail: 'accredited', external_reference: 'daledeal-order-42-1', metadata: { order_id: 42, buyer_id: 7 } });

    const res = await request(app).get('/payments/42/status?payment_id=555').set('Authorization', `Bearer ${tokenFor(7)}`);
    expect(res.status).toBe(200);
    expect(mpGet).toHaveBeenCalledWith({ id: '555' });
    expect(res.body.order).toMatchObject({ payment_status: 'paid', status: 'confirmed' });
    expect(res.body.order.mp_external_reference).toBeUndefined();
  });

  test('payment_id de otra orden → no se aplica', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/AS conversation_id/i.test(sql)) return { rowCount: 1, rows: [statusRow()] };
      return { rowCount: 0, rows: [] };
    });
    mpGet.mockResolvedValue({ id: 556, status: 'approved', external_reference: 'daledeal-order-99-1', metadata: { order_id: 99 } });
    const res = await request(app).get('/payments/42/status?payment_id=556').set('Authorization', `Bearer ${tokenFor(7)}`);
    expect(res.status).toBe(200);
    expect(res.body.order.payment_status).toBe('pending');
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  test('sin payment_id no le pregunta a MP', async () => {
    db.query.mockImplementation(async (sql) => (/AS conversation_id/i.test(sql) ? { rowCount: 1, rows: [statusRow()] } : { rowCount: 0, rows: [] }));
    const res = await request(app).get('/payments/42/status').set('Authorization', `Bearer ${tokenFor(7)}`);
    expect(res.status).toBe(200);
    expect(mpGet).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
describe('PATCH /orders/:id/status', () => {
  const wire = (order) => {
    db.query.mockImplementation(async (sql) => {
      if (/SELECT seller_id, buyer_id, status, payment_status/i.test(sql)) return { rowCount: 1, rows: [order] };
      if (/UPDATE orders SET status = \$1/i.test(sql)) return { rowCount: 1, rows: [{ ...order, id: 42 }] };
      if (/SELECT \* FROM orders/i.test(sql)) return { rowCount: 1, rows: [{ ...order, id: 42 }] };
      return { rowCount: 0, rows: [] };
    });
    return fakeClient(async (sql) => {
      if (/FOR UPDATE/i.test(sql)) return { rowCount: 1, rows: [order] };
      if (/SELECT \* FROM orders/i.test(sql)) return { rowCount: 1, rows: [{ ...order, id: 42, status: 'cancelled' }] };
    });
  };
  const base = { seller_id: 9, buyer_id: 7, product_id: 5, quantity: 1 };

  test('el comprador NO puede cancelar una orden paga (la plata quedaba retenida sin reembolso)', async () => {
    const client = wire({ ...base, status: 'confirmed', payment_status: 'paid' });
    const res = await request(app).patch('/orders/42/status').set('Authorization', `Bearer ${tokenFor(7)}`).send({ status: 'cancelled' });
    expect(res.status).toBe(409);
    expect(client.sqls.some(q => /UPDATE products/i.test(q.sql))).toBe(false);
  });

  test('el comprador cancela una orden sin pagar → se devuelve el stock', async () => {
    const client = wire({ ...base, status: 'pending', payment_status: 'rejected' });
    const res = await request(app).patch('/orders/42/status').set('Authorization', `Bearer ${tokenFor(7)}`).send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    const stock = client.sqls.find(q => /UPDATE products/i.test(q.sql));
    expect(stock.params).toEqual([1, 5]);
  });

  test('una orden despachada no se cancela desde acá', async () => {
    wire({ ...base, status: 'shipped', payment_status: 'paid' });
    const res = await request(app).patch('/orders/42/status').set('Authorization', `Bearer ${tokenFor(9)}`).send({ status: 'cancelled' });
    expect(res.status).toBe(409);
  });

  test('el vendedor no puede marcar entregada una orden sin pagar', async () => {
    wire({ ...base, status: 'pending', payment_status: 'pending' });
    const res = await request(app).patch('/orders/42/status').set('Authorization', `Bearer ${tokenFor(9)}`).send({ status: 'delivered' });
    expect(res.status).toBe(409);
  });

  test('una orden no vuelve a un estado anterior', async () => {
    wire({ ...base, status: 'shipped', payment_status: 'paid' });
    const res = await request(app).patch('/orders/42/status').set('Authorization', `Bearer ${tokenFor(9)}`).send({ status: 'confirmed' });
    expect(res.status).toBe(409);
  });

  test('retiro en persona: el vendedor marca entregada una orden paga y confirmada', async () => {
    wire({ ...base, status: 'confirmed', payment_status: 'paid' });
    const res = await request(app).patch('/orders/42/status').set('Authorization', `Bearer ${tokenFor(9)}`).send({ status: 'delivered' });
    expect(res.status).toBe(200);
  });
});

// ------------------------------------------------------------
describe('POST /orders/:id/confirm-delivery con retiro en persona', () => {
  const wire = (order) => db.query.mockImplementation(async (sql) => {
    if (/SELECT buyer_id, status, payment_status, shipping_method, buyer_confirmed_at/i.test(sql)) return { rowCount: 1, rows: [order] };
    if (/SET buyer_confirmed_at = NOW\(\)/i.test(sql)) return { rowCount: 1, rows: [{ id: 42, status: 'delivered' }] };
    return { rowCount: 0, rows: [] };
  });

  test('pickup pagado y confirmado → el comprador puede cerrar la compra', async () => {
    wire({ buyer_id: 7, status: 'confirmed', payment_status: 'paid', shipping_method: 'pickup', buyer_confirmed_at: null });
    const res = await request(app).post('/orders/42/confirm-delivery').set('Authorization', `Bearer ${tokenFor(7)}`);
    expect(res.status).toBe(200);
  });

  test('envío a domicilio todavía no despachado → 409', async () => {
    wire({ buyer_id: 7, status: 'confirmed', payment_status: 'paid', shipping_method: 'delivery', buyer_confirmed_at: null });
    const res = await request(app).post('/orders/42/confirm-delivery').set('Authorization', `Bearer ${tokenFor(7)}`);
    expect(res.status).toBe(409);
  });

  test('pickup sin pagar → 409', async () => {
    wire({ buyer_id: 7, status: 'confirmed', payment_status: 'pending', shipping_method: 'pickup', buyer_confirmed_at: null });
    const res = await request(app).post('/orders/42/confirm-delivery').set('Authorization', `Bearer ${tokenFor(7)}`);
    expect(res.status).toBe(409);
  });
});

// ------------------------------------------------------------
describe('auth: cuenta suspendida', () => {
  test('token válido de una cuenta desactivada → 401', async () => {
    db.query.mockImplementation(async (sql) => (AUTH_SQL.test(sql) ? { rowCount: 1, rows: [{ is_active: false }] } : { rowCount: 0, rows: [] }));
    const res = await request(app).get('/orders/my').set('Authorization', `Bearer ${tokenFor(3101)}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/suspendida o desactivada/);
  });

  test('si la base falla en el chequeo, no corta (el controller decide)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    db.query.mockImplementation(async (sql) => {
      if (AUTH_SQL.test(sql)) throw new Error('db caída');
      return { rowCount: 0, rows: [] };
    });
    const res = await request(app).get('/orders/my').set('Authorization', `Bearer ${tokenFor(3102)}`);
    spy.mockRestore();
    expect(res.status).toBe(200);
  });
});

// ------------------------------------------------------------
describe('productos: bajas y estados', () => {
  test('el vendedor no puede poner status "deleted" con PUT', async () => {
    db.query.mockImplementation(async (sql) => (/SELECT seller_id, status FROM products/i.test(sql) ? { rowCount: 1, rows: [{ seller_id: 9, status: 'active' }] } : { rowCount: 0, rows: [] }));
    const res = await request(app).put('/products/5').set('Authorization', `Bearer ${tokenFor(9)}`).send({ status: 'deleted' });
    expect(res.status).toBe(400);
  });

  test('un producto dado de baja no se puede reactivar', async () => {
    db.query.mockImplementation(async (sql) => (/SELECT seller_id, status FROM products/i.test(sql) ? { rowCount: 1, rows: [{ seller_id: 9, status: 'deleted' }] } : { rowCount: 0, rows: [] }));
    const res = await request(app).put('/products/5').set('Authorization', `Bearer ${tokenFor(9)}`).send({ status: 'active' });
    expect(res.status).toBe(404);
  });

  test('DELETE es un borrado lógico', async () => {
    db.query.mockImplementation(async (sql) => (/SELECT seller_id FROM products/i.test(sql) ? { rowCount: 1, rows: [{ seller_id: 9 }] } : { rowCount: 1, rows: [] }));
    const res = await request(app).delete('/products/5').set('Authorization', `Bearer ${tokenFor(9)}`);
    expect(res.status).toBe(200);
    const sqls = db.query.mock.calls.map(([sql]) => sql);
    expect(sqls.some(s => /DELETE FROM products/i.test(s))).toBe(false);
    expect(sqls.some(s => /UPDATE products SET status = 'deleted'/i.test(s))).toBe(true);
  });
});

// ------------------------------------------------------------
describe('POST /admin/orders/:id/refund', () => {
  test('orden ya liberada al vendedor → 409 y no llama a MP', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    db.query.mockImplementation(async (sql) => (/SELECT role, is_active FROM users/i.test(sql) ? { rowCount: 1, rows: [{ role: 'admin', is_active: true }] } : { rowCount: 0, rows: [] }));
    const client = fakeClient(async (sql) => {
      if (/FOR UPDATE OF o/i.test(sql)) return { rowCount: 1, rows: [{ id: 42, payment_status: 'paid', status: 'delivered', mp_payment_id: '111', total_price: '100', release_status: 'released' }] };
    });
    const res = await request(app).post('/admin/orders/42/refund').set('Authorization', `Bearer ${tokenFor(1, 'admin')}`).send({});
    expect(res.status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(client.sqls.map(q => q.sql)).toContain('ROLLBACK');
    fetchSpy.mockRestore();
  });
});

// ------------------------------------------------------------
describe('vencimiento de órdenes sin pagar', () => {
  const { expireStalePendingOrders, EXPIRE_HOURS } = require('../src/services/orderExpiry');

  test('cancela las vencidas y devuelve el stock de cada una', async () => {
    const client = fakeClient(async (sql) => {
      if (/UPDATE orders/i.test(sql)) return { rowCount: 2, rows: [{ id: 1, product_id: 5, quantity: 2 }, { id: 2, product_id: 8, quantity: 1 }] };
    });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const n = await expireStalePendingOrders();
    spy.mockRestore();
    expect(n).toBe(2);
    const upd = client.sqls.find(q => /UPDATE orders/i.test(q.sql));
    expect(upd.sql).toMatch(/status = 'pending'/);
    expect(upd.params).toEqual([['pending', 'rejected', 'cancelled'], EXPIRE_HOURS]);
    const stock = client.sqls.filter(q => /UPDATE products/i.test(q.sql)).map(q => q.params);
    expect(stock).toEqual([[2, 5], [1, 8]]);
    expect(client.sqls.map(q => q.sql)).toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('por default vencen a las 72 h (el plazo de un ticket de MP)', () => {
    expect(EXPIRE_HOURS).toBe(72);
  });

  test('si la base falla, hace ROLLBACK y no rompe el proceso', async () => {
    const client = fakeClient(async (sql) => { if (/UPDATE orders/i.test(sql)) throw new Error('db caída'); });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(expireStalePendingOrders()).resolves.toBe(0);
    spy.mockRestore();
    expect(client.sqls.map(q => q.sql)).toContain('ROLLBACK');
  });
});

// ------------------------------------------------------------
describe('cambio de contraseña', () => {
  const bcrypt = require('bcryptjs');

  test('contraseña actual incorrecta → 400 (no 401: el front te deslogeaba)', async () => {
    const hash = await bcrypt.hash('Correcta123', 4);
    db.query.mockImplementation(async (sql) => (/SELECT password_hash FROM users/i.test(sql) ? { rowCount: 1, rows: [{ password_hash: hash }] } : { rowCount: 0, rows: [] }));
    const res = await request(app).post('/auth/change-password').set('Authorization', `Bearer ${tokenFor(7)}`)
      .send({ currentPassword: 'Otra12345', newPassword: 'Nueva12345' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/actual incorrecta/);
  });

  test('cuenta de Google sin contraseña → 400 con explicación', async () => {
    db.query.mockImplementation(async (sql) => (/SELECT password_hash FROM users/i.test(sql) ? { rowCount: 1, rows: [{ password_hash: null }] } : { rowCount: 0, rows: [] }));
    const res = await request(app).post('/auth/change-password').set('Authorization', `Bearer ${tokenFor(7)}`)
      .send({ currentPassword: 'Algo12345', newPassword: 'Nueva12345' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Google/);
  });
});

// ------------------------------------------------------------
describe('POST /orders: método de envío', () => {
  const product = { id: 5, title: 'Bici', price: '10000', currency: 'ARS', stock: 3, seller_id: 9, status: 'active',
    shipping_required: true, offers_delivery: true, offers_pickup: false, shipping_cost: '2500', pickup_address: null };

  test('un shipping_method inventado → 400 (antes: retiro gratis aunque no hubiera retiro)', async () => {
    db.query.mockImplementation(async (sql) => (/FROM products WHERE id = \$1/i.test(sql) ? { rowCount: 1, rows: [product] } : { rowCount: 0, rows: [] }));
    const res = await request(app).post('/orders').set('Authorization', `Bearer ${tokenFor(7)}`)
      .send({ product_id: 5, quantity: 1, shipping_method: 'gratis' });
    expect(res.status).toBe(400);
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  test('retiro cuando el vendedor solo ofrece envío → 400', async () => {
    db.query.mockImplementation(async (sql) => (/FROM products WHERE id = \$1/i.test(sql) ? { rowCount: 1, rows: [product] } : { rowCount: 0, rows: [] }));
    const res = await request(app).post('/orders').set('Authorization', `Bearer ${tokenFor(7)}`)
      .send({ product_id: 5, quantity: 1, shipping_method: 'pickup' });
    expect(res.status).toBe(400);
  });
});

