/**
 * Avisos al vendedor sobre su plata (escrow 015):
 *  - mail cuando el admin libera el pago     (POST /admin/orders/:id/release)
 *  - mail cuando el comprador confirma        (POST /orders/:id/confirm-delivery)
 *  - "Mis ventas" dice en qué quedó el cobro  (GET  /orders/sales)
 *
 * Base y envío de mails mockeados: no dependen de migrations ni de Resend.
 */
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  pool:  { connect: jest.fn() },
}));
jest.mock('../src/services/email', () => {
  const actual = jest.requireActual('../src/services/email');
  return { ...actual, sendEmail: jest.fn().mockResolvedValue({ ok: true }) };
});

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const db      = require('../src/config/database');
const email   = require('../src/services/email');
const app     = require('../src/index');
const { _resetStoreForTests } = require('../src/middleware/rateLimiter');

const tokenFor = (id, role = 'user') =>
  jwt.sign({ id, email: `u${id}@test.com`, role }, process.env.JWT_SECRET, { expiresIn: '1h' });

// Los avisos salen sin esperar ("fire and forget"): damos unas vueltas al event loop.
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

beforeEach(() => {
  _resetStoreForTests();
  db.query.mockReset();
  db.pool.connect.mockReset();
  email.sendEmail.mockReset();
  email.sendEmail.mockResolvedValue({ ok: true });
});

// ------------------------------------------------------------
describe('templates', () => {
  test('pago liberado: neto, comprobante y HTML escapado', () => {
    const t = email.payoutReleasedSellerTemplate({
      sellerName: 'Carlos', orderId: 42, productTitle: 'Bici <script>',
      gross: '10000.00', commission: '500.00', net: '9500.00', reference: 'MP-123',
    });
    expect(t.subject).toContain('#42');
    expect(t.html).toContain('9.500');
    expect(t.html).toContain('MP-123');
    expect(t.html).not.toContain('<script>');
    expect(t.text).toContain('9.500');
    expect(t.text).toContain('MP-123');
  });

  test('pago liberado sin comprobante: no muestra esa fila', () => {
    const t = email.payoutReleasedSellerTemplate({ orderId: 1, gross: 100, commission: 5, net: 95 });
    expect(t.html).not.toContain('Comprobante de Mercado Pago');
  });

  test('recepción confirmada: comprador, producto y neto', () => {
    const t = email.buyerConfirmedSellerTemplate({ sellerName: 'Carlos', orderId: 7, productTitle: 'Mate', buyerName: 'Ana', net: 9500 });
    expect(t.subject).toContain('#7');
    expect(t.html).toContain('Ana');
    expect(t.html).toContain('Mate');
    expect(t.html).toContain('9.500');
  });

  test('venta nueva: ya no promete el pago al entregar', () => {
    const t = email.newSaleSellerTemplate({ orderId: 1, productTitle: 'X', buyerName: 'Y', total: 100 });
    expect(t.html).not.toMatch(/Una vez entregado, tu pago será liberado/);
    expect(t.html).toMatch(/confirme que lo recibió/);
  });
});

// ------------------------------------------------------------
describe('POST /admin/orders/:id/release → aviso al vendedor', () => {
  const liberable = {
    id: 42, seller_id: 9, total_price: '10000.00', commission_amount: '500.00', currency: 'ARS',
    payment_status: 'paid', release_status: 'retained', releasable: true,
  };
  const wireAdmin = () => {
    db.query.mockImplementation(async (sql) => {
      if (/SELECT role, is_active FROM users/i.test(sql)) return { rowCount: 1, rows: [{ role: 'admin', is_active: true }] };
      if (/seller_email/i.test(sql)) return { rowCount: 1, rows: [{ seller_email: 'vende@test.com', seller_name: 'Carlos', product_title: 'Bici' }] };
      return { rowCount: 0, rows: [] };
    });
  };
  const wireTx = (orderRow) => {
    const client = {
      query: jest.fn(async (sql) => {
        if (/FOR UPDATE/i.test(sql)) return { rowCount: orderRow ? 1 : 0, rows: orderRow ? [orderRow] : [] };
        if (/INSERT INTO payouts/i.test(sql)) {
          return { rowCount: 1, rows: [{ id: 7, order_id: 42, seller_id: 9, gross_amount: '10000.00', commission_amount: '500.00', net_amount: '9500.00', currency: 'ARS', reference: 'MP-123', note: null }] };
        }
        return { rowCount: 1, rows: [] };
      }),
      release: jest.fn(),
    };
    db.pool.connect.mockResolvedValue(client);
    return client;
  };

  test('libera, registra y le manda al vendedor el neto y el comprobante', async () => {
    wireAdmin();
    const client = wireTx(liberable);
    const res = await request(app).post('/admin/orders/42/release')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)
      .send({ reference: 'MP-123' });
    expect(res.status).toBe(201);
    expect(client.query.mock.calls.map(c => String(c[0]).trim())).toContain('COMMIT');
    await flush();
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    const arg = email.sendEmail.mock.calls[0][0];
    expect(arg.to).toBe('vende@test.com');
    expect(arg.subject).toContain('#42');
    expect(arg.html).toContain('9.500');
    expect(arg.html).toContain('MP-123');
  });

  test('si todavía no es liberable (409) no sale ningún mail', async () => {
    wireAdmin();
    wireTx({ ...liberable, releasable: false });
    const res = await request(app).post('/admin/orders/42/release')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`).send({});
    expect(res.status).toBe(409);
    await flush();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  test('si el mail falla, la liberación igual queda hecha (201)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    wireAdmin();
    wireTx(liberable);
    email.sendEmail.mockRejectedValueOnce(new Error('Resend caído'));
    const res = await request(app).post('/admin/orders/42/release')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`).send({});
    expect(res.status).toBe(201);
    await flush();
    expect(spy).toHaveBeenCalledWith('[email] payout notify failed:', 'Resend caído');
    spy.mockRestore();
  });
});

// ------------------------------------------------------------
describe('POST /orders/:id/confirm-delivery → aviso al vendedor', () => {
  const wire = ({ confirmed = null, payment = 'paid' } = {}) => {
    db.query.mockImplementation(async (sql) => {
      if (/SELECT buyer_id, status, buyer_confirmed_at FROM orders/i.test(sql)) {
        return { rowCount: 1, rows: [{ buyer_id: 7, status: 'shipped', buyer_confirmed_at: confirmed }] };
      }
      if (/SET buyer_confirmed_at = NOW\(\)/i.test(sql)) return { rowCount: 1, rows: [{ id: 42, status: 'delivered', buyer_confirmed_at: new Date() }] };
      if (/seller_email/i.test(sql)) {
        return { rowCount: 1, rows: [{ id: 42, total_price: '10000.00', commission_amount: '500.00', payment_status: payment, product_title: 'Bici', seller_email: 'vende@test.com', seller_name: 'Carlos', buyer_name: 'Ana' }] };
      }
      if (/SELECT \* FROM orders/i.test(sql)) return { rowCount: 1, rows: [{ id: 42 }] };
      return { rowCount: 1, rows: [] };
    });
  };

  test('primera confirmación → mail al vendedor con el neto', async () => {
    wire();
    const res = await request(app).post('/orders/42/confirm-delivery').set('Authorization', `Bearer ${tokenFor(7)}`);
    expect(res.status).toBe(200);
    await flush();
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    const arg = email.sendEmail.mock.calls[0][0];
    expect(arg.to).toBe('vende@test.com');
    expect(arg.subject).toContain('#42');
    expect(arg.html).toContain('Ana');
    expect(arg.html).toContain('9.500');
  });

  test('si ya había confirmado, no se repite el mail', async () => {
    wire({ confirmed: new Date() });
    const res = await request(app).post('/orders/42/confirm-delivery').set('Authorization', `Bearer ${tokenFor(7)}`);
    expect(res.status).toBe(200);
    await flush();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  test('orden sin pago acreditado → no le promete cobro al vendedor', async () => {
    wire({ payment: 'pending' });
    const res = await request(app).post('/orders/42/confirm-delivery').set('Authorization', `Bearer ${tokenFor(7)}`);
    expect(res.status).toBe(200);
    await flush();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
describe('GET /orders/sales → estado del cobro', () => {
  test('devuelve release_status, si es liberable y el payout registrado', async () => {
    const sqls = [];
    db.query.mockImplementation(async (sql) => {
      sqls.push(sql);
      return { rowCount: 1, rows: [{
        id: 42, status: 'delivered', payment_status: 'paid', total_price: '10000.00', commission_amount: '500.00',
        release_status: 'released', released_at: new Date('2026-09-20T12:00:00Z'), releasable: true,
        payout_net: '9500.00', payout_reference: 'MP-123',
      }] };
    });
    const res = await request(app).get('/orders/sales').set('Authorization', `Bearer ${tokenFor(9)}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ release_status: 'released', payout_net: '9500.00', payout_reference: 'MP-123', releasable: true });
    expect(sqls[0]).toMatch(/LEFT JOIN payouts pay ON pay\.order_id = o\.id/);
    expect(sqls[0]).toMatch(/AS releasable/);
    expect(sqls[0]).toMatch(/o\.commission_amount/);
  });

  test('sin la tabla payouts (42P01) responde igual, sin datos de cobro', async () => {
    const sqls = [];
    db.query.mockImplementation(async (sql) => {
      sqls.push(sql);
      if (/payouts/.test(sql)) { const e = new Error('relation "payouts" does not exist'); e.code = '42P01'; throw e; }
      return { rowCount: 1, rows: [{ id: 42, status: 'shipped', payment_status: 'paid' }] };
    });
    const res = await request(app).get('/orders/sales').set('Authorization', `Bearer ${tokenFor(9)}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(42);
    expect(res.body.data[0].release_status).toBeUndefined();
    expect(sqls).toHaveLength(2);
    expect(sqls[1]).not.toMatch(/payouts/);
  });
});

// ------------------------------------------------------------
describe("GET /orders/my → la compra sabe si el pago ya se liberó", () => {
  test("incluye release_status en el grupo con fallback", async () => {
    const sqls = [];
    db.query.mockImplementation(async (sql) => { sqls.push(sql); return { rowCount: 1, rows: [{ id: 9, status: "delivered", release_status: "released" }] }; });
    const res = await request(app).get("/orders/my").set("Authorization", `Bearer ${tokenFor(1)}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].release_status).toBe("released");
    expect(sqls[0]).toMatch(/o\.release_status/);
  });
});
