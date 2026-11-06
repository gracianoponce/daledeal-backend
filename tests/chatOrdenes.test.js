/**
 * Chat comprador ↔ vendedor de una orden (06/11/2026).
 *
 * Con el checkout de Mercado Pago no se creaba ningún chat: Mis compras y los
 * mails decían "coordiná por chat" pero comprador y vendedor no tenían cómo
 * hablar. Se cubre:
 *  - POST /orders/:id/conversation (botones de Mis compras / Mis ventas).
 *  - El webhook abre el chat al acreditarse el pago y los mails llevan el link.
 *  - Aviso por mail de mensaje nuevo (uno por tanda sin leer).
 *  - findOrCreateConversation aguanta la carrera webhook ↔ botón.
 * Base y Mercado Pago mockeados: no hace falta Postgres.
 */
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  pool:  { connect: jest.fn() },
}));
jest.mock('../src/services/email', () => {
  const actual = jest.requireActual('../src/services/email');
  return { ...actual, sendEmail: jest.fn() };
});
const mockPaymentGet = jest.fn();
jest.mock('../src/config/mercadopago', () => ({
  client: {},
  requireClient: () => ({}),
  Preference: class {},
  MerchantOrder: class {},
  Payment: class { get(args) { return mockPaymentGet(args); } },
  isConfigured: true,
  isSandbox: false,
}));

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const db      = require('../src/config/database');
const email   = require('../src/services/email');
const app     = require('../src/index');
const { ensureOrderConversation, findOrCreateConversation } = require('../src/controllers/messageController');
const { _resetStoreForTests } = require('../src/middleware/rateLimiter');

const tokenFor = (id) => jwt.sign({ id, email: `u${id}@test.com`, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

// Orden 9: comprador 11, vendedor 10, producto 34, paga.
const ORDER = { id: 9, buyer_id: 11, seller_id: 10, product_id: 34, status: 'confirmed', payment_status: 'paid' };
const CONV  = { id: 77, buyer_id: 11, seller_id: 10, product_id: 34, service_id: null, order_id: 9, item_type: 'product' };

let savedSecret;
beforeAll(() => { savedSecret = process.env.MP_WEBHOOK_SECRET; });
afterAll(() => { if (savedSecret === undefined) delete process.env.MP_WEBHOOK_SECRET; else process.env.MP_WEBHOOK_SECRET = savedSecret; });

beforeEach(() => {
  _resetStoreForTests();
  db.query.mockReset();
  db.pool.connect.mockReset();
  email.sendEmail.mockReset();
  email.sendEmail.mockResolvedValue({ ok: true });
  mockPaymentGet.mockReset();
});

// Router de SQL para el mock: cada test dice qué devuelve cada consulta.
function routeQueries(handlers) {
  db.query.mockImplementation(async (sql, params) => {
    for (const [re, fn] of handlers) {
      if (re.test(sql)) return typeof fn === 'function' ? fn(sql, params) : fn;
    }
    return { rows: [], rowCount: 0 };
  });
}
const calls = (re) => db.query.mock.calls.filter(([sql]) => re.test(sql));

describe('POST /orders/:id/conversation', () => {
  test('sin sesión → 401', async () => {
    const res = await request(app).post('/orders/9/conversation');
    expect(res.status).toBe(401);
  });

  test('id no numérico → 400', async () => {
    const res = await request(app).post('/orders/9abc/conversation').set('Authorization', `Bearer ${tokenFor(11)}`);
    expect(res.status).toBe(400);
    expect(calls(/FROM orders/)).toHaveLength(0);
  });

  test('orden inexistente → 404', async () => {
    routeQueries([[/FROM orders WHERE id = \$1/, { rows: [] }]]);
    const res = await request(app).post('/orders/999/conversation').set('Authorization', `Bearer ${tokenFor(11)}`);
    expect(res.status).toBe(404);
  });

  test('alguien que no es comprador ni vendedor → 403 y no crea nada', async () => {
    routeQueries([[/FROM orders WHERE id = \$1/, { rows: [ORDER] }]]);
    const res = await request(app).post('/orders/9/conversation').set('Authorization', `Bearer ${tokenFor(99)}`);
    expect(res.status).toBe(403);
    expect(calls(/INSERT INTO conversations/)).toHaveLength(0);
  });

  test('orden sin pagar → 409 (no hay chat antes del pago)', async () => {
    routeQueries([[/FROM orders WHERE id = \$1/, { rows: [{ ...ORDER, status: 'pending', payment_status: 'pending' }] }]]);
    const res = await request(app).post('/orders/9/conversation').set('Authorization', `Bearer ${tokenFor(11)}`);
    expect(res.status).toBe(409);
    expect(calls(/INSERT INTO conversations/)).toHaveLength(0);
  });

  test('pago en proceso → 409', async () => {
    routeQueries([[/FROM orders WHERE id = \$1/, { rows: [{ ...ORDER, status: 'pending', payment_status: 'in_process' }] }]]);
    const res = await request(app).post('/orders/9/conversation').set('Authorization', `Bearer ${tokenFor(11)}`);
    expect(res.status).toBe(409);
  });

  test('publicación borrada (sin product_id) → 409 con aviso', async () => {
    routeQueries([[/FROM orders WHERE id = \$1/, { rows: [{ ...ORDER, product_id: null }] }]]);
    const res = await request(app).post('/orders/9/conversation').set('Authorization', `Bearer ${tokenFor(11)}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Contacto/);
  });

  test('comprador con orden paga → 201 y crea el chat enganchado a la orden', async () => {
    routeQueries([
      [/FROM orders WHERE id = \$1/, { rows: [ORDER] }],
      [/SELECT \* FROM conversations/, { rows: [] }],
      [/INSERT INTO conversations/, { rows: [CONV] }],
    ]);
    const res = await request(app).post('/orders/9/conversation').set('Authorization', `Bearer ${tokenFor(11)}`);
    expect(res.status).toBe(201);
    expect(res.body.conversation.id).toBe(77);
    const [sql, params] = calls(/INSERT INTO conversations/)[0];
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/);
    expect(params).toEqual([11, 10, 34, null, 9, 'product']);
  });

  test('vendedor con chat ya existente → 200, lo reutiliza y le engancha la orden', async () => {
    routeQueries([
      [/FROM orders WHERE id = \$1/, { rows: [ORDER] }],
      [/SELECT \* FROM conversations/, { rows: [{ ...CONV, order_id: null }] }],
    ]);
    const res = await request(app).post('/orders/9/conversation').set('Authorization', `Bearer ${tokenFor(10)}`);
    expect(res.status).toBe(200);
    expect(res.body.conversation.order_id).toBe(9);
    expect(calls(/UPDATE conversations SET order_id/)[0][1]).toEqual([9, 77]);
    expect(calls(/INSERT INTO conversations/)).toHaveLength(0);
  });

  test('orden reembolsada (estuvo paga) → se puede seguir hablando', async () => {
    routeQueries([
      [/FROM orders WHERE id = \$1/, { rows: [{ ...ORDER, status: 'cancelled', payment_status: 'refunded' }] }],
      [/SELECT \* FROM conversations/, { rows: [CONV] }],
    ]);
    const res = await request(app).post('/orders/9/conversation').set('Authorization', `Bearer ${tokenFor(11)}`);
    expect(res.status).toBe(200);
  });
});

describe('findOrCreateConversation: carrera webhook ↔ botón', () => {
  test('si otro lo creó entre medio (INSERT sin filas), devuelve el existente', async () => {
    let selects = 0;
    routeQueries([
      [/SELECT \* FROM conversations/, () => (++selects === 1 ? { rows: [] } : { rows: [CONV] })],
      [/INSERT INTO conversations/, { rows: [] }],
    ]);
    const r = await findOrCreateConversation({ buyer_id: 11, seller_id: 10, item_type: 'product', product_id: 34, order_id: 9 });
    expect(r).toEqual({ conversation: CONV, created: false });
    expect(selects).toBe(2);
  });
});

describe('ensureOrderConversation', () => {
  test('crea el chat con los datos de la orden', async () => {
    routeQueries([
      [/FROM orders WHERE id = \$1/, { rows: [ORDER] }],
      [/SELECT \* FROM conversations/, { rows: [] }],
      [/INSERT INTO conversations/, { rows: [CONV] }],
    ]);
    await expect(ensureOrderConversation(9)).resolves.toEqual(CONV);
    expect(calls(/INSERT INTO conversations/)[0][1]).toEqual([11, 10, 34, null, 9, 'product']);
  });

  test('orden sin producto o inexistente → null, sin crear nada', async () => {
    routeQueries([[/FROM orders WHERE id = \$1/, { rows: [{ ...ORDER, product_id: null }] }]]);
    await expect(ensureOrderConversation(9)).resolves.toBeNull();
    routeQueries([[/FROM orders WHERE id = \$1/, { rows: [] }]]);
    await expect(ensureOrderConversation(9)).resolves.toBeNull();
    expect(calls(/INSERT INTO conversations/)).toHaveLength(0);
  });
});

describe('Webhook de MP: al acreditarse el pago se abre el chat', () => {
  function mockPaidTransaction() {
    const client = {
      query: jest.fn(async (sql) => {
        if (/FOR UPDATE/.test(sql)) {
          return { rows: [{ id: 9, status: 'pending', payment_status: 'pending', mp_payment_id: null,
            release_status: null, seller_id: 10, total_price: '450000.00', commission_amount: '13500.00' }] };
        }
        return { rows: [], rowCount: 1 };
      }),
      release: jest.fn(),
    };
    db.pool.connect.mockResolvedValue(client);
    return client;
  }

  test('pago aprobado → chat creado y los dos mails con el link al chat', async () => {
    delete process.env.MP_WEBHOOK_SECRET; // dev/test: acepta sin firma
    mockPaymentGet.mockResolvedValue({ id: 555, status: 'approved', external_reference: 'ord-9', metadata: { order_id: 9, buyer_id: 11 }, live_mode: true });
    mockPaidTransaction();
    routeQueries([
      [/FROM orders\s+WHERE mp_external_reference/, { rows: [{ id: 9, buyer_id: 11 }] }],
      [/SELECT id, buyer_id, seller_id, product_id FROM orders WHERE id = \$1/, { rows: [ORDER] }],
      [/SELECT \* FROM conversations/, { rows: [] }],
      [/INSERT INTO conversations/, { rows: [CONV] }],
      [/ub\.email AS buyer_email/, { rows: [{ id: 9, total_price: '450000.00', shipping_method: 'pickup', product_title: 'Freezer vertical',
        buyer_email: 'comprador@test.com', buyer_name: 'Comprador', seller_email: 'vendedor@test.com', seller_name: 'Hugo', seller_payout_account: 'alias.x' }] }],
    ]);

    const res = await request(app).post('/payments/webhook?type=payment&data.id=555').send({ type: 'payment', data: { id: '555' } });
    expect(res.status).toBe(200);
    await flush();

    expect(calls(/INSERT INTO conversations/)[0][1]).toEqual([11, 10, 34, null, 9, 'product']);
    const sent = email.sendEmail.mock.calls.map(([m]) => m);
    const buyer  = sent.find(m => m.to === 'comprador@test.com');
    const seller = sent.find(m => m.to === 'vendedor@test.com');
    expect(buyer.html).toContain('https://daledeal.com.ar/notificaciones?conv=77#mensajes');
    expect(buyer.text).toContain('Escribile al vendedor: https://daledeal.com.ar/notificaciones?conv=77#mensajes');
    expect(seller.html).toContain('https://daledeal.com.ar/notificaciones?conv=77#mensajes');
    expect(seller.html).toContain('Escribirle al comprador');
  });

  test('si el chat falla, los mails salen igual (con el link a Mensajes)', async () => {
    delete process.env.MP_WEBHOOK_SECRET;
    mockPaymentGet.mockResolvedValue({ id: 556, status: 'approved', external_reference: 'ord-9', metadata: { order_id: 9 }, live_mode: true });
    mockPaidTransaction();
    routeQueries([
      [/FROM orders\s+WHERE mp_external_reference/, { rows: [{ id: 9, buyer_id: 11 }] }],
      [/SELECT id, buyer_id, seller_id, product_id FROM orders WHERE id = \$1/, () => { throw new Error('boom'); }],
      [/ub\.email AS buyer_email/, { rows: [{ id: 9, total_price: '100', shipping_method: 'delivery', product_title: 'X',
        buyer_email: 'comprador@test.com', buyer_name: 'C', seller_email: 'vendedor@test.com', seller_name: 'V', seller_payout_account: 'a' }] }],
    ]);
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).post('/payments/webhook?type=payment&data.id=556').send({ type: 'payment', data: { id: '556' } });
    expect(res.status).toBe(200);
    await flush();
    err.mockRestore();
    expect(email.sendEmail).toHaveBeenCalledTimes(2);
    expect(email.sendEmail.mock.calls[0][0].html).toContain('https://daledeal.com.ar/notificaciones#mensajes');
  });
});

describe('Aviso por mail de mensaje nuevo', () => {
  const convRow = { id: 77, buyer_id: 11, seller_id: 10, product_id: 34, service_id: null, item_type: 'product' };

  function setup({ pendingUnread = false, active = false }) {
    routeQueries([
      [/SELECT id, buyer_id, seller_id, product_id, service_id, item_type\s+FROM conversations/, { rows: [convRow] }],
      [/INSERT INTO messages/, { rows: [{ id: 501, conversation_id: 77, sender_id: 11, body: 'hola', read_at: null, created_at: new Date().toISOString() }] }],
      [/AS pending/, { rows: [{ pending: pendingUnread, active }] }],
      [/ur\.email AS recipient_email/, { rows: [{ id: 77, order_id: 9, from_buyer: true, recipient_email: 'vendedor@test.com',
        recipient_name: 'Hugo', sender_name: 'Comprador &amp; Cía', item_title: 'Freezer &quot;vertical&quot;' }] }],
    ]);
  }

  test('primer mensaje sin leer → mail al otro con link al chat, texto escapado', async () => {
    setup({ pendingUnread: false });
    const res = await request(app).post('/messages/conversations/77/messages')
      .set('Authorization', `Bearer ${tokenFor(11)}`)
      .send({ body: '¿Lo puedo retirar el sábado? <b>gracias</b>' });
    expect(res.status).toBe(201);
    await flush();
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    const m = email.sendEmail.mock.calls[0][0];
    expect(m.to).toBe('vendedor@test.com');
    expect(m.subject).toBe('💬 Comprador & Cía te escribió en Dale Deal');
    expect(m.html).toContain('https://daledeal.com.ar/notificaciones?conv=77#mensajes');
    expect(m.html).toContain('comprador de la orden #9');
    expect(m.html).not.toContain('<b>gracias</b>');
    expect(m.text).toContain('Freezer "vertical"');
  });

  test('ya tenía un mensaje sin leer de esa persona → no manda otro mail', async () => {
    setup({ pendingUnread: true });
    const res = await request(app).post('/messages/conversations/77/messages')
      .set('Authorization', `Bearer ${tokenFor(11)}`)
      .send({ body: 'otro mensaje' });
    expect(res.status).toBe(201);
    await flush();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  test('el otro está chateando en vivo (activo hace < 5 min) → no manda mail', async () => {
    setup({ active: true });
    const res = await request(app).post('/messages/conversations/77/messages')
      .set('Authorization', `Bearer ${tokenFor(11)}`)
      .send({ body: 'dale, nos vemos' });
    expect(res.status).toBe(201);
    await flush();
    expect(email.sendEmail).not.toHaveBeenCalled();
    const [sql, params] = calls(/AS pending/)[0];
    expect(sql).toMatch(/INTERVAL '5 minutes'/);
    expect(params).toEqual([77, 11, 501]);
  });

  test('si el mail falla, el mensaje igual se guarda (201)', async () => {
    setup({ pendingUnread: false });
    email.sendEmail.mockRejectedValue(new Error('resend caído'));
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).post('/messages/conversations/77/messages')
      .set('Authorization', `Bearer ${tokenFor(11)}`)
      .send({ body: 'hola' });
    expect(res.status).toBe(201);
    await flush();
    err.mockRestore();
  });
});

describe('Templates', () => {
  test('mensaje largo se corta a 300 caracteres', () => {
    const t = email.newMessageTemplate({ senderName: 'A', preview: 'x'.repeat(400), conversationId: 1, fromBuyer: false });
    expect(t.text).toContain('x'.repeat(300) + '…');
    expect(t.text).not.toContain('x'.repeat(301));
  });

  test('compra confirmada sin chat → link a la lista de Mensajes', () => {
    const t = email.orderPaidBuyerTemplate({ orderId: 1, productTitle: 'X', total: 1, sellerName: 'V', isPickup: true });
    expect(t.html).toContain('https://daledeal.com.ar/notificaciones#mensajes');
    expect(t.html).toContain('Escribirle al vendedor');
  });
});
