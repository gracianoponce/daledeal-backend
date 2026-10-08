/**
 * Verificación de prestadores con documentos (migración 018):
 *  - POST /verifications/documents: DNI frente/dorso + cara (+ título) en base64.
 *  - GET /verifications/me y GET /admin/verifications traen los documentos (sin bytes).
 *  - GET /admin/verification-documents/:id devuelve el archivo solo a un admin.
 *  - POST /admin/verifications/:id/review guarda los datos del documento,
 *    borra los archivos y avisa por mail.
 *  - POST /services exige identidad y título verificados.
 * La base y los mails van mockeados.
 */
jest.mock('../src/config/database', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
jest.mock('../src/services/email', () => {
  const actual = jest.requireActual('../src/services/email');
  return { ...actual, sendEmail: jest.fn() };
});
const request = require('supertest');
const jwt     = require('jsonwebtoken');
const db      = require('../src/config/database');
const email   = require('../src/services/email');
const app     = require('../src/index');
const { _resetStoreForTests } = require('../src/middleware/rateLimiter');

const tokenFor = (id, role = 'user') =>
  jwt.sign({ id, email: `u${id}@test.com`, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
const png = 'data:image/png;base64,' + Buffer.from('fake-png-bytes').toString('base64');
const AUTH_SQL = /SELECT is_active FROM users WHERE id/;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

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
// db.query por defecto: la sesión está activa; el resto, vacío.
const defaultQuery = (handler) => async (sql, params) => {
  if (AUTH_SQL.test(sql)) return { rowCount: 1, rows: [{ is_active: true }] };
  return (handler && await handler(sql, params)) || { rowCount: 0, rows: [] };
};

beforeEach(() => {
  _resetStoreForTests();
  db.query.mockReset();
  db.query.mockImplementation(defaultQuery());
  db.pool.connect.mockReset();
  email.sendEmail.mockReset();
  email.sendEmail.mockResolvedValue({ ok: true });
});

describe('POST /verifications/documents', () => {
  test('sin consentimiento → 400', async () => {
    const res = await request(app).post('/verifications/documents').set('Authorization', `Bearer ${tokenFor(7)}`)
      .send({ dni_front: png, dni_back: png, selfie: png });
    expect(res.status).toBe(400);
  });
  test('falta un documento obligatorio → 400', async () => {
    const res = await request(app).post('/verifications/documents').set('Authorization', `Bearer ${tokenFor(7)}`)
      .send({ dni_front: png, selfie: png, consent: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dorso/i);
  });
  test('un PDF como foto del DNI → 400', async () => {
    const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4').toString('base64');
    const res = await request(app).post('/verifications/documents').set('Authorization', `Bearer ${tokenFor(7)}`)
      .send({ dni_front: pdf, dni_back: png, selfie: png, consent: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/foto/i);
  });
  test('DNI + cara + título → crea pedido identity y professional con sus documentos', async () => {
    db.query.mockImplementation(defaultQuery(async (sql) => /SELECT verified_identity, verified_professional/.test(sql)
      ? { rowCount: 1, rows: [{ verified_identity: false, verified_professional: false }] } : undefined));
    const client = fakeClient(async (sql, params) => {
      if (/INSERT INTO verification_requests/.test(sql)) return { rowCount: 1, rows: [{ id: 11, type: params[1], status: 'pending' }] };
    });
    const res = await request(app).post('/verifications/documents').set('Authorization', `Bearer ${tokenFor(7)}`)
      .send({ dni_front: png, dni_back: png, selfie: png, title: png, consent: true });
    expect(res.status).toBe(201);
    expect(res.body.requests.map(r => r.type)).toEqual(['identity', 'professional']);
    const docInserts = client.sqls.filter(q => /INSERT INTO verification_documents/.test(q.sql));
    expect(docInserts).toHaveLength(4);
    expect(docInserts.map(q => q.params[2])).toEqual(['dni_front', 'dni_back', 'selfie', 'title']);
    expect(Buffer.isBuffer(docInserts[0].params[4])).toBe(true);
    expect(client.sqls.map(q => q.sql)).toContain('COMMIT');
  });
  test('ya verificado → 409', async () => {
    db.query.mockImplementation(defaultQuery(async (sql) => /SELECT verified_identity, verified_professional/.test(sql)
      ? { rowCount: 1, rows: [{ verified_identity: true, verified_professional: true }] } : undefined));
    fakeClient();
    const res = await request(app).post('/verifications/documents').set('Authorization', `Bearer ${tokenFor(7)}`)
      .send({ dni_front: png, dni_back: png, selfie: png, consent: true });
    expect(res.status).toBe(409);
  });
  test('ya hay un pedido pendiente (índice único) → 409 y rollback', async () => {
    db.query.mockImplementation(defaultQuery(async (sql) => /SELECT verified_identity, verified_professional/.test(sql)
      ? { rowCount: 1, rows: [{ verified_identity: false, verified_professional: false }] } : undefined));
    const client = fakeClient(async (sql) => {
      if (/INSERT INTO verification_requests/.test(sql)) { const e = new Error('dup'); e.code = '23505'; throw e; }
    });
    const res = await request(app).post('/verifications/documents').set('Authorization', `Bearer ${tokenFor(7)}`)
      .send({ dni_front: png, dni_back: png, selfie: png, consent: true });
    expect(res.status).toBe(409);
    expect(client.sqls.map(q => q.sql)).toContain('ROLLBACK');
  });
});
