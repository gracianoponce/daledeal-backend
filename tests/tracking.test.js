/**
 * Tests del tracking de envíos (migration 016).
 *
 * - Servicio puro: catálogo de correos, links de seguimiento, parseo del
 *   webhook de Ship24, verificación del secreto y alta del tracker (fetch mockeado).
 * - Rutas: cableado + auth + reglas de negocio con la base mockeada, así no
 *   dependen de que la migration 016 esté aplicada en la base local/CI.
 */
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  pool:  { connect: jest.fn() },
}));

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const db      = require('../src/config/database');
const app     = require('../src/index');
const tracking = require('../src/services/tracking');
const { _resetStoreForTests } = require('../src/middleware/rateLimiter');

const tokenFor = (id, role = 'user') =>
  jwt.sign({ id, email: `u${id}@test.com`, role }, process.env.JWT_SECRET, { expiresIn: '1h' });

// Payload real de la spec OpenAPI de Ship24 (recortado a lo que usamos).
const ship24Payload = (over = {}) => ({
  trackings: [{
    metadata: { generatedAt: '2025-03-04T17:13:35.000Z', messageId: '356a7f93-3ce5-4b49-b560-156537283df9' },
    tracker: {
      trackerId: '26148317-7502-d3ac-44a9-546d240ac0dd',
      trackingNumber: '360000012345678',
      clientTrackerId: 'dd-order-42',
      ...over.tracker,
    },
    shipment: { statusMilestone: 'delivered', statusCode: 'delivery_delivered', ...over.shipment },
    events: over.events || [
      {
        eventId: 'ee8ebe96-4eae-4a91-9a99-8f3afa6a0f46',
        status: 'Entregado al destinatario',
        occurrenceDatetime: '2025-03-04T17:12:57',
        datetime: '2025-03-04T20:12:57.000Z',
        location: 'La Plata, Buenos Aires',
        courierCode: 'andreani',
        statusMilestone: 'delivered',
      },
      {
        eventId: 'aa000000-0000-0000-0000-000000000001',
        status: 'En camino a la sucursal de destino',
        occurrenceDatetime: '2025-03-03T09:00:00',
        datetime: '2025-03-03T12:00:00.000Z',
        location: 'CABA',
        statusMilestone: 'in_transit',
      },
    ],
    statistics: { timestamps: { deliveredDatetime: '2025-03-04T17:12:57' } },
  }],
});

const ENV_KEYS = ['SHIP24_API_KEY', 'SHIP24_WEBHOOK_SECRET', 'SHIP24_COURIER_CODES'];
const savedEnv = {};
beforeAll(() => { ENV_KEYS.forEach(k => { savedEnv[k] = process.env[k]; }); });
afterAll(()  => { ENV_KEYS.forEach(k => { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }); });

beforeEach(() => {
  _resetStoreForTests();
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  ENV_KEYS.forEach(k => delete process.env[k]);
});

// ------------------------------------------------------------
describe('tracking service — catálogo y links', () => {
  test('listCarriers expone slug + name y nada interno', () => {
    const list = tracking.listCarriers();
    const slugs = list.map(c => c.slug);
    expect(slugs).toEqual(expect.arrayContaining(['correo_argentino', 'andreani', 'oca', 'via_cargo', 'other']));
    list.forEach(c => {
      expect(Object.keys(c).sort()).toEqual(['name', 'slug']);
      expect(typeof c.name).toBe('string');
    });
  });

  test('isValidCarrier', () => {
    expect(tracking.isValidCarrier('andreani')).toBe(true);
    expect(tracking.isValidCarrier('ANDREANI')).toBe(false);
    expect(tracking.isValidCarrier('fedex-trucho')).toBe(false);
    expect(tracking.isValidCarrier(undefined)).toBe(false);
  });

  test('buildTrackingUrl: Andreani va directo al envío, con el número escapado', () => {
    expect(tracking.buildTrackingUrl('andreani', '360000012345678'))
      .toBe('https://www.andreani.com/envio/360000012345678');
    expect(tracking.buildTrackingUrl('andreani', 'AB 12/3'))
      .toBe('https://www.andreani.com/envio/AB%2012%2F3');
  });

  test('buildTrackingUrl: correos sin link directo → su página de seguimiento', () => {
    expect(tracking.buildTrackingUrl('correo_argentino', 'CP123456789AR'))
      .toBe('https://www.correoargentino.com.ar/seguimiento-de-envios');
    expect(tracking.buildTrackingUrl('oca', '1234567890'))
      .toBe('https://www.oca.com.ar/Seguimiento/BuscarEnvio/paquetes');
  });

  test('buildTrackingUrl: "other" o correo desconocido → buscador universal', () => {
    expect(tracking.buildTrackingUrl('other', 'XY123')).toBe('https://www.ship24.com/tracking?p=XY123');
    expect(tracking.buildTrackingUrl(null, 'XY123')).toBe('https://www.ship24.com/tracking?p=XY123');
  });

  test('buildTrackingUrl: sin número no hay link', () => {
    expect(tracking.buildTrackingUrl('andreani', '')).toBeNull();
    expect(tracking.buildTrackingUrl('andreani', null)).toBeNull();
  });

  test('statusLabel traduce los hitos y tolera desconocidos', () => {
    expect(tracking.statusLabel('out_for_delivery')).toMatch(/reparto/i);
    expect(tracking.statusLabel('delivered')).toBe('Entregado');
    expect(tracking.statusLabel('cualquiera')).toBeNull();
  });
});

// ------------------------------------------------------------
describe('tracking service — webhook', () => {
  test('verifyWebhookSecret: sin configurar / ok / incorrecto', () => {
    expect(tracking.verifyWebhookSecret('Bearer x')).toBe('unconfigured');
    process.env.SHIP24_WEBHOOK_SECRET = 's3cr3t-largo';
    expect(tracking.verifyWebhookSecret('Bearer s3cr3t-largo')).toBe('ok');
    expect(tracking.verifyWebhookSecret('Bearer otro')).toBe('invalid');
    expect(tracking.verifyWebhookSecret('s3cr3t-largo')).toBe('invalid');
    expect(tracking.verifyWebhookSecret(undefined)).toBe('invalid');
  });

  test('parseWebhookBody normaliza tracker, hito y eventos (hora UTC)', () => {
    const [t] = tracking.parseWebhookBody(ship24Payload());
    expect(t.orderId).toBe(42);
    expect(t.trackerId).toBe('26148317-7502-d3ac-44a9-546d240ac0dd');
    expect(t.trackingNumber).toBe('360000012345678');
    expect(t.milestone).toBe('delivered');
    expect(t.events).toHaveLength(2);
    expect(t.events[0]).toMatchObject({
      id: 'ee8ebe96-4eae-4a91-9a99-8f3afa6a0f46',
      milestone: 'delivered',
      description: 'Entregado al destinatario',
      location: 'La Plata, Buenos Aires',
    });
    expect(t.events[0].occurredAt.toISOString()).toBe('2025-03-04T20:12:57.000Z');
    expect(t.statusAt.toISOString()).toBe('2025-03-04T20:12:57.000Z');
  });

  test('parseWebhookBody descarta basura sin romper', () => {
    expect(tracking.parseWebhookBody(null)).toEqual([]);
    expect(tracking.parseWebhookBody({ trackings: 'x' })).toEqual([]);
    const [t] = tracking.parseWebhookBody(ship24Payload({
      tracker: { clientTrackerId: 'ajeno-7' },
      shipment: { statusMilestone: 'inventado' },
      events: [{ status: 'sin id ni fecha' }],
    }));
    expect(t.orderId).toBeNull();
    expect(t.milestone).toBeNull();
    expect(t.events).toEqual([]);
  });
});

// ------------------------------------------------------------
describe('tracking service — alta del tracker en Ship24', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  test('sin API key no llama a nadie', async () => {
    global.fetch = jest.fn();
    const r = await tracking.registerTracker({ orderId: 1, trackingNumber: '360000012345678', carrier: 'andreani' });
    expect(r).toEqual({ ok: false, skipped: 'disabled' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('número con formato que Ship24 rechaza → no se registra', async () => {
    process.env.SHIP24_API_KEY = 'apik_test';
    global.fetch = jest.fn();
    const r = await tracking.registerTracker({ orderId: 1, trackingNumber: 'a b', carrier: 'oca' });
    expect(r).toEqual({ ok: false, skipped: 'invalid_format' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('registra con Bearer, clientTrackerId de la orden y país AR', async () => {
    process.env.SHIP24_API_KEY = 'apik_test';
    process.env.SHIP24_COURIER_CODES = JSON.stringify({ andreani: 'andreani' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({ data: { tracker: { trackerId: 'trk-1' } } }),
    });
    const r = await tracking.registerTracker({ orderId: 42, trackingNumber: ' 360000012345678 ', carrier: 'andreani', postalCode: '1900' });
    expect(r).toEqual({ ok: true, trackerId: 'trk-1' });

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.ship24.com/public/v1/trackers');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer apik_test');
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({
      trackingNumber: '360000012345678',
      clientTrackerId: 'dd-order-42',
      orderNumber: '42',
      originCountryCode: 'AR',
      destinationCountryCode: 'AR',
      destinationPostCode: '1900',
      courierCode: ['andreani'],
    });
  });

  test('si Ship24 responde error o se cae la red, no explota', async () => {
    process.env.SHIP24_API_KEY = 'apik_test';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ errors: [{ code: 'validation_error' }] }) });
    expect(await tracking.registerTracker({ orderId: 1, trackingNumber: '360000012345678', carrier: 'oca' }))
      .toMatchObject({ ok: false, error: expect.stringContaining('400') });
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    expect(await tracking.registerTracker({ orderId: 1, trackingNumber: '360000012345678', carrier: 'oca' }))
      .toMatchObject({ ok: false, error: expect.stringContaining('ECONNRESET') });
  });
});

// ------------------------------------------------------------
describe('rutas — correos y tracking de una orden', () => {
  test('GET /shipping/carriers es público y dice si hay tracking automático', async () => {
    const res = await request(app).get('/shipping/carriers');
    expect(res.status).toBe(200);
    expect(res.body.auto_tracking).toBe(false);
    expect(res.body.data.map(c => c.slug)).toContain('correo_argentino');
  });

  test('GET /orders/1/tracking sin token → 401', async () => {
    const res = await request(app).get('/orders/1/tracking');
    expect(res.status).toBe(401);
  });

  test('GET /orders/:id/tracking: el comprador ve correo, link, estado y eventos', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM orders/i.test(sql)) {
        return { rowCount: 1, rows: [{
          id: 42, buyer_id: 7, seller_id: 9, status: 'shipped', shipping_method: 'delivery',
          tracking_number: '360000012345678', shipping_carrier: 'andreani',
          tracking_status: 'in_transit', tracking_status_at: new Date('2025-03-03T12:00:00Z'),
          tracking_provider_id: 'trk-1', dispatched_at: new Date('2025-03-02T12:00:00Z'),
          delivered_at: null, delivered_source: null,
        }] };
      }
      if (/FROM order_tracking_events/i.test(sql)) {
        return { rowCount: 1, rows: [{ status: 'in_transit', description: 'En camino', location: 'CABA', occurred_at: new Date('2025-03-03T12:00:00Z') }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app).get('/orders/42/tracking').set('Authorization', `Bearer ${tokenFor(7)}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      order_id: 42,
      carrier: { slug: 'andreani', name: 'Andreani' },
      tracking_number: '360000012345678',
      tracking_url: 'https://www.andreani.com/envio/360000012345678',
      status: 'in_transit',
      status_label: 'En camino',
      auto: true,
    });
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0]).toMatchObject({ status: 'in_transit', label: 'En camino', location: 'CABA' });
  });

  test('GET /orders/:id/tracking: un tercero no puede mirar → 403', async () => {
    db.query.mockResolvedValue({ rowCount: 1, rows: [{ id: 42, buyer_id: 7, seller_id: 9 }] });
    const res = await request(app).get('/orders/42/tracking').set('Authorization', `Bearer ${tokenFor(1234)}`);
    expect(res.status).toBe(403);
  });

  test('GET /orders/:id/tracking: con la migration 016 pendiente responde igual (sin estados)', async () => {
    let first = true;
    db.query.mockImplementation(async (sql) => {
      if (first && /shipping_carrier/.test(sql)) { first = false; const e = new Error('column does not exist'); e.code = '42703'; throw e; }
      if (/FROM orders/i.test(sql)) {
        return { rowCount: 1, rows: [{ id: 42, buyer_id: 7, seller_id: 9, status: 'shipped', shipping_method: 'delivery', tracking_number: 'XY12345' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app).get('/orders/42/tracking').set('Authorization', `Bearer ${tokenFor(7)}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tracking_number: 'XY12345', carrier: null, status: null, events: [], auto: false });
    expect(res.body.tracking_url).toBe('https://www.ship24.com/tracking?p=XY12345');
  });

  test('PATCH /orders/:id/shipping con un correo inventado → 400', async () => {
    const res = await request(app).patch('/orders/42/shipping')
      .set('Authorization', `Bearer ${tokenFor(9)}`)
      .send({ tracking_number: '360000012345678', carrier: 'fedex-trucho' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/correo/i);
  });

  test('PATCH /orders/:id/shipping guarda el correo junto con el número', async () => {
    const sqls = [];
    db.query.mockImplementation(async (sql, params) => {
      sqls.push({ sql, params });
      if (/^\s*SELECT/i.test(sql)) {
        return { rowCount: 1, rows: [{ seller_id: 9, status: 'confirmed', payment_status: 'paid', shipping_method: 'delivery', tracking_number: null, shipping_postal_code: '1900' }] };
      }
      return { rowCount: 1, rows: [{ id: 42, status: 'shipped', tracking_number: '360000012345678', shipping_carrier: 'andreani' }] };
    });
    const res = await request(app).patch('/orders/42/shipping')
      .set('Authorization', `Bearer ${tokenFor(9)}`)
      .send({ tracking_number: '360000012345678', carrier: 'andreani', mark_shipped: true });
    expect(res.status).toBe(200);
    const upd = sqls.find(q => /UPDATE orders/i.test(q.sql) && /shipping_carrier/.test(q.sql));
    expect(upd).toBeTruthy();
    expect(upd.params).toContain('andreani');
    expect(res.body.order.tracking_url).toBe('https://www.andreani.com/envio/360000012345678');
  });
});

// ------------------------------------------------------------
describe('POST /webhooks/ship24', () => {
  const orderRow = (over = {}) => ({
    id: 42, buyer_id: 7, seller_id: 9, status: 'shipped', payment_status: 'paid',
    tracking_number: '360000012345678', delivered_at: null, ...over,
  });
  const wire = (order) => {
    const sqls = [];
    db.query.mockImplementation(async (sql, params) => {
      sqls.push({ sql, params });
      if (/^\s*SELECT/i.test(sql) && /FROM orders\b/i.test(sql) && !/JOIN/i.test(sql)) {
        return order ? { rowCount: 1, rows: [order] } : { rowCount: 0, rows: [] };
      }
      if (/^\s*UPDATE orders/i.test(sql)) return { rowCount: 1, rows: [{ id: 42 }] };
      if (/^\s*INSERT INTO order_tracking_events/i.test(sql)) return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    });
    return sqls;
  };

  test('sin secreto configurado → 503 (Ship24 reintenta más tarde)', async () => {
    const res = await request(app).post('/webhooks/ship24').send(ship24Payload());
    expect(res.status).toBe(503);
  });

  test('secreto incorrecto → 401 y no toca la base', async () => {
    process.env.SHIP24_WEBHOOK_SECRET = 's3cr3t-largo';
    const res = await request(app).post('/webhooks/ship24').set('Authorization', 'Bearer nope').send(ship24Payload());
    expect(res.status).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('entregado por el correo → guarda eventos, marca delivered con origen "carrier"', async () => {
    process.env.SHIP24_WEBHOOK_SECRET = 's3cr3t-largo';
    const sqls = wire(orderRow());
    const res = await request(app).post('/webhooks/ship24').set('Authorization', 'Bearer s3cr3t-largo').send(ship24Payload());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: 1, processed: 1 });

    expect(sqls.filter(q => /INSERT INTO order_tracking_events/i.test(q.sql))).toHaveLength(2);
    const delivered = sqls.find(q => /UPDATE orders/i.test(q.sql) && /status\s*=\s*'delivered'/.test(q.sql));
    expect(delivered).toBeTruthy();
    expect(delivered.sql).toMatch(/delivered_source/);
    expect(delivered.sql).toMatch(/status IN \('confirmed', ?'shipped'\)/);
    expect(delivered.params).toContain('carrier');
  });

  test('en camino con la orden todavía "confirmed" → pasa a despachada, no a entregada', async () => {
    process.env.SHIP24_WEBHOOK_SECRET = 's3cr3t-largo';
    const sqls = wire(orderRow({ status: 'confirmed' }));
    const payload = ship24Payload({ shipment: { statusMilestone: 'in_transit' } });
    payload.trackings[0].events = [payload.trackings[0].events[1]];
    const res = await request(app).post('/webhooks/ship24').set('Authorization', 'Bearer s3cr3t-largo').send(payload);
    expect(res.status).toBe(200);
    expect(sqls.some(q => /UPDATE orders/i.test(q.sql) && /status\s*=\s*'shipped'/.test(q.sql))).toBe(true);
    expect(sqls.some(q => /UPDATE orders/i.test(q.sql) && /status\s*=\s*'delivered'/.test(q.sql))).toBe(false);
  });

  test('tracker viejo (el vendedor cambió el número) → se ignora', async () => {
    process.env.SHIP24_WEBHOOK_SECRET = 's3cr3t-largo';
    const sqls = wire(orderRow({ tracking_number: 'OTRO-NUMERO-999' }));
    const res = await request(app).post('/webhooks/ship24').set('Authorization', 'Bearer s3cr3t-largo').send(ship24Payload());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: 1, processed: 0 });
    expect(sqls.some(q => /^\s*(UPDATE|INSERT)/i.test(q.sql))).toBe(false);
  });

  test('orden inexistente o cancelada → 200 igual, sin escribir', async () => {
    process.env.SHIP24_WEBHOOK_SECRET = 's3cr3t-largo';
    let sqls = wire(null);
    let res = await request(app).post('/webhooks/ship24').set('Authorization', 'Bearer s3cr3t-largo').send(ship24Payload());
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(0);

    sqls = wire(orderRow({ status: 'cancelled' }));
    res = await request(app).post('/webhooks/ship24').set('Authorization', 'Bearer s3cr3t-largo').send(ship24Payload());
    expect(res.status).toBe(200);
    expect(sqls.some(q => /status\s*=\s*'delivered'/.test(q.sql))).toBe(false);
  });

  test('cuerpo vacío o roto → 200 con 0 recibidos', async () => {
    process.env.SHIP24_WEBHOOK_SECRET = 's3cr3t-largo';
    const res = await request(app).post('/webhooks/ship24').set('Authorization', 'Bearer s3cr3t-largo').send({ hola: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: 0, processed: 0 });
  });
});
