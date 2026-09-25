/**
 * Datos de cobro del vendedor (migration 017):
 *  - validación de alias / CVU / CBU (con dígitos verificadores del BCRA)
 *  - GET/PUT /users/me/payout-account (solo el dueño) + mail de aviso al cambiar
 *  - el login NO devuelve los datos de cobro
 *  - el admin los ve en la cola de retenciones y queda registrado a qué cuenta se liberó
 * Base, bcrypt y mails mockeados.
 */
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  pool:  { connect: jest.fn() },
}));
jest.mock('../src/services/email', () => {
  const actual = jest.requireActual('../src/services/email');
  return { ...actual, sendEmail: jest.fn().mockResolvedValue({ ok: true }) };
});
jest.mock('bcryptjs', () => ({
  compare: jest.fn().mockResolvedValue(true),
  hash:    jest.fn().mockResolvedValue('hash'),
  genSalt: jest.fn().mockResolvedValue('salt'),
}));

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const db      = require('../src/config/database');
const email   = require('../src/services/email');
const app     = require('../src/index');
const svc     = require('../src/services/payoutAccount');
const { _resetStoreForTests } = require('../src/middleware/rateLimiter');

const tokenFor = (id, role = 'user') =>
  jwt.sign({ id, email: `u${id}@test.com`, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
const pgError = (code) => Object.assign(new Error('pg ' + code), { code });

beforeEach(() => {
  _resetStoreForTests();
  db.query.mockReset();
  db.pool.connect.mockReset();
  email.sendEmail.mockReset();
  email.sendEmail.mockResolvedValue({ ok: true });
});

// ------------------------------------------------------------
describe('validación de alias / CVU / CBU', () => {
  test.each([
    '2850590940090418135201',
    '0170099220000067797370',
    '0110599520000001235579',
  ])('CBU válido (ejemplo público) %s', (cbu) => {
    expect(svc.normalizePayoutAccount(cbu)).toEqual({ ok: true, value: cbu, kind: 'cbu' });
  });

  test('CBU tipeado con espacios y guiones se normaliza', () => {
    expect(svc.normalizePayoutAccount(' 2850590-9 400904181352 01 ')).toEqual({ ok: true, value: '2850590940090418135201', kind: 'cbu' });
  });

  test('CVU (empieza con 000) se reconoce como CVU', () => {
    expect(svc.normalizePayoutAccount('0000003110001000000004')).toMatchObject({ ok: true, kind: 'cvu' });
  });

  test('dígito verificador mal → rechazado', () => {
    expect(svc.normalizePayoutAccount('2850590940090418135202')).toMatchObject({ ok: false, error: expect.stringMatching(/no es válido/) });
    expect(svc.normalizePayoutAccount('2850591940090418135201')).toMatchObject({ ok: false });
  });

  test('números que no son 22 → pide los 22', () => {
    expect(svc.normalizePayoutAccount('12345')).toMatchObject({ ok: false, error: 'El CBU o CVU tiene 22 números.' });
  });

  test('alias válido se guarda en mayúsculas', () => {
    expect(svc.normalizePayoutAccount('dale.deal-mp')).toEqual({ ok: true, value: 'DALE.DEAL-MP', kind: 'alias' });
  });

  test.each([
    ['', /Ingresá/],
    ['abc', /entre 6 y 20/],
    ['hola mundo', /no lleva espacios/],
    ['juan_perez.mp', /entre 6 y 20/],
    ['este.alias.es.demasiado.largo', /entre 6 y 20/],
  ])('alias inválido %j', (value, msg) => {
    expect(svc.normalizePayoutAccount(value)).toMatchObject({ ok: false, error: expect.stringMatching(msg) });
  });

  test('titular: se limpia y exige un nombre', () => {
    expect(svc.normalizeHolder('  Juan   Pérez ')).toEqual({ ok: true, value: 'Juan Pérez' });
    expect(svc.normalizeHolder('J')).toMatchObject({ ok: false });
    expect(svc.normalizeHolder(undefined)).toMatchObject({ ok: false });
  });

  test('describePayoutAccount arma la etiqueta', () => {
    expect(svc.describePayoutAccount('DALE.DEAL.MP')).toEqual({ kind: 'alias', label: 'Alias DALE.DEAL.MP' });
    expect(svc.describePayoutAccount('0000003110001000000004').label).toBe('CVU 0000003110001000000004');
    expect(svc.describePayoutAccount(null)).toBeNull();
  });
});

// ------------------------------------------------------------
describe('GET/PUT /users/me/payout-account', () => {
  test('sin token → 401', async () => {
    expect((await request(app).get('/users/me/payout-account')).status).toBe(401);
    expect((await request(app).put('/users/me/payout-account').send({ account: 'dale.deal.mp', holder: 'Juan' })).status).toBe(401);
  });

  test('GET devuelve los datos propios con su etiqueta', async () => {
    db.query.mockResolvedValue({ rowCount: 1, rows: [{ payout_account: 'DALE.DEAL.MP', payout_holder: 'Juan Pérez', payout_updated_at: new Date('2026-09-20T10:00:00Z') }] });
    const res = await request(app).get('/users/me/payout-account').set('Authorization', `Bearer ${tokenFor(9)}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: true, account: 'DALE.DEAL.MP', kind: 'alias', label: 'Alias DALE.DEAL.MP', holder: 'Juan Pérez' });
    expect(db.query.mock.calls[0][1]).toEqual([9]);
  });

  test('GET con la migration pendiente → available:false', async () => {
    db.query.mockRejectedValue(pgError('42703'));
    const res = await request(app).get('/users/me/payout-account').set('Authorization', `Bearer ${tokenFor(9)}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: false, account: null });
  });

  test('PUT con alias inválido → 400 y no escribe', async () => {
    const res = await request(app).put('/users/me/payout-account')
      .set('Authorization', `Bearer ${tokenFor(9)}`).send({ account: 'hola mundo', holder: 'Juan Pérez' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ field: 'account', error: expect.stringMatching(/espacios/) });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('PUT sin titular → 400', async () => {
    const res = await request(app).put('/users/me/payout-account')
      .set('Authorization', `Bearer ${tokenFor(9)}`).send({ account: 'dale.deal.mp', holder: '' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('holder');
  });

  test('PUT válido guarda normalizado, responde y avisa por mail al dueño', async () => {
    db.query.mockResolvedValue({ rowCount: 1, rows: [{ payout_account: 'DALE.DEAL.MP', payout_holder: 'Juan Pérez', payout_updated_at: new Date(), email: 'vende@test.com', name: 'Juan' }] });
    const res = await request(app).put('/users/me/payout-account')
      .set('Authorization', `Bearer ${tokenFor(9)}`).send({ account: ' dale.deal.mp ', holder: ' Juan  Pérez ' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ account: 'DALE.DEAL.MP', kind: 'alias', holder: 'Juan Pérez', message: expect.any(String) });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE users/);
    expect(params).toEqual(['DALE.DEAL.MP', 'Juan Pérez', 9]);
    await flush();
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    const arg = email.sendEmail.mock.calls[0][0];
    expect(arg.to).toBe('vende@test.com');
    expect(arg.subject).toMatch(/datos de cobro/i);
    expect(arg.html).toContain('Alias DALE.DEAL.MP');
  });

  test('PUT con la migration pendiente → 503', async () => {
    db.query.mockRejectedValue(pgError('42703'));
    const res = await request(app).put('/users/me/payout-account')
      .set('Authorization', `Bearer ${tokenFor(9)}`).send({ account: 'dale.deal.mp', holder: 'Juan Pérez' });
    expect(res.status).toBe(503);
  });
});

// ------------------------------------------------------------
describe('POST /auth/login no devuelve datos de cobro', () => {
  test('la respuesta no trae hash ni cuenta ni titular', async () => {
    db.query.mockResolvedValue({ rowCount: 1, rows: [{
      id: 9, name: 'Juan', email: 'vende@test.com', role: 'user', is_active: true,
      password_hash: 'x', payout_account: 'DALE.DEAL.MP', payout_holder: 'Juan Pérez', payout_updated_at: new Date(),
    }] });
    const res = await request(app).post('/auth/login').send({ email: 'vende@test.com', password: 'Demo1234' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 9, email: 'vende@test.com' });
    ['password_hash', 'payout_account', 'payout_holder', 'payout_updated_at'].forEach(k => expect(res.body.user).not.toHaveProperty(k));
  });
});

// ------------------------------------------------------------
describe('admin: datos de cobro en retenciones', () => {
  const asAdmin = (handler) => db.query.mockImplementation(async (sql, params) => {
    if (/SELECT role, is_active FROM users/i.test(sql)) return { rowCount: 1, rows: [{ role: 'admin', is_active: true }] };
    return handler(sql, params);
  });

  test('la cola trae la cuenta y el titular del vendedor', async () => {
    const sqls = [];
    asAdmin(async (sql) => { sqls.push(sql); return { rowCount: 1, rows: [{ id: 42, seller_payout_account: 'DALE.DEAL.MP', seller_payout_holder: 'Juan Pérez' }] }; });
    const res = await request(app).get('/admin/payouts/pending').set('Authorization', `Bearer ${tokenFor(1, 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.orders[0]).toMatchObject({ seller_payout_account: 'DALE.DEAL.MP', seller_payout_holder: 'Juan Pérez' });
    expect(sqls[0]).toMatch(/us\.payout_account AS seller_payout_account/);
  });

  test('sin la migration 017 la cola igual responde (sin datos de cobro)', async () => {
    const sqls = [];
    asAdmin(async (sql) => {
      sqls.push(sql);
      if (/payout_account/.test(sql)) throw pgError('42703');
      return { rowCount: 1, rows: [{ id: 42 }] };
    });
    const res = await request(app).get('/admin/payouts/pending').set('Authorization', `Bearer ${tokenFor(1, 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(sqls).toHaveLength(2);
    expect(sqls[1]).not.toMatch(/payout_account/);
  });

  test('el historial trae a qué cuenta se liberó', async () => {
    const sqls = [];
    asAdmin(async (sql) => { sqls.push(sql); return { rowCount: 1, rows: [{ payout_id: 7, destination: 'Alias DALE.DEAL.MP · Juan Pérez' }] }; });
    const res = await request(app).get('/admin/payouts/released').set('Authorization', `Bearer ${tokenFor(1, 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.payouts[0].destination).toBe('Alias DALE.DEAL.MP · Juan Pérez');
    expect(sqls[0]).toMatch(/p\.destination/);
  });

  test('al liberar se registra la cuenta de destino y el mail la muestra', async () => {
    const sqls = [];
    asAdmin(async (sql, params) => {
      sqls.push({ sql, params });
      if (/seller_email/i.test(sql)) return { rowCount: 1, rows: [{ seller_email: 'vende@test.com', seller_name: 'Juan', product_title: 'Bici', payout_account: 'DALE.DEAL.MP', payout_holder: 'Juan Pérez' }] };
      return { rowCount: 1, rows: [] };
    });
    const client = {
      query: jest.fn(async (sql) => {
        if (/FOR UPDATE/i.test(sql)) return { rowCount: 1, rows: [{ id: 42, seller_id: 9, total_price: '10000.00', commission_amount: '500.00', currency: 'ARS', payment_status: 'paid', release_status: 'retained', releasable: true }] };
        if (/INSERT INTO payouts/i.test(sql)) return { rowCount: 1, rows: [{ id: 7, order_id: 42, gross_amount: '10000.00', commission_amount: '500.00', net_amount: '9500.00', reference: 'MP-1' }] };
        return { rowCount: 1, rows: [] };
      }),
      release: jest.fn(),
    };
    db.pool.connect.mockResolvedValue(client);

    const res = await request(app).post('/admin/orders/42/release').set('Authorization', `Bearer ${tokenFor(1, 'admin')}`).send({ reference: 'MP-1' });
    expect(res.status).toBe(201);
    await flush();
    const upd = sqls.find(q => /UPDATE payouts SET destination/i.test(q.sql));
    expect(upd).toBeTruthy();
    expect(upd.params).toEqual(['Alias DALE.DEAL.MP · Juan Pérez', 7]);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][0].html).toContain('Alias DALE.DEAL.MP · Juan Pérez');
  });
});

// ------------------------------------------------------------
describe('mails: recordatorio de cargar los datos de cobro', () => {
  test('venta nueva con y sin datos de cobro', () => {
    const base = { orderId: 1, productTitle: 'X', buyerName: 'Y', total: 100 };
    expect(email.newSaleSellerTemplate({ ...base, needsPayoutAccount: true }).html).toContain('Cargá tus datos de cobro');
    expect(email.newSaleSellerTemplate({ ...base, needsPayoutAccount: false }).html).not.toContain('Cargá tus datos de cobro');
  });

  test('recepción confirmada con recordatorio', () => {
    const t = email.buyerConfirmedSellerTemplate({ orderId: 7, productTitle: 'Mate', buyerName: 'Ana', net: 100, needsPayoutAccount: true });
    expect(t.html).toContain('mi-cuenta#datos-cobro');
    expect(t.text).toContain('mi-cuenta#datos-cobro');
  });

  test('aviso de cambio de datos de cobro', () => {
    const t = email.payoutAccountChangedTemplate({ name: 'Juan', accountLabel: 'CVU 0000003110001000000004', holder: 'Juan <b>' });
    expect(t.html).toContain('CVU 0000003110001000000004');
    expect(t.html).not.toContain('<b>');
    expect(t.html).toMatch(/No fuiste vos/);
  });
});
