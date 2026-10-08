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
const ROLE_SQL = /SELECT role, is_active FROM users WHERE id/; // requireAdmin: el id 1 es admin
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
  if (ROLE_SQL.test(sql)) return { rowCount: 1, rows: [{ role: params?.[0] === 1 ? 'admin' : 'user', is_active: true }] };
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

describe('documentos: listado y descarga', () => {
  test('GET /verifications/me trae los documentos de cada pedido sin los bytes', async () => {
    db.query.mockImplementation(defaultQuery(async (sql) => {
      if (/FROM users WHERE id/.test(sql)) return { rowCount: 1, rows: [{ verified_identity: false, verified_professional: false, verified_background: false, verified_at: null }] };
      if (/FROM verification_requests/.test(sql)) return { rowCount: 1, rows: [{ id: 11, type: 'identity', status: 'pending', admin_note: null, created_at: 'x', reviewed_at: null }] };
      if (/FROM verification_documents/.test(sql)) return { rowCount: 1, rows: [{ id: 5, request_id: 11, kind: 'dni_front', mime: 'image/jpeg', size: 1234 }] };
    }));
    const res = await request(app).get('/verifications/me').set('Authorization', `Bearer ${tokenFor(7)}`);
    expect(res.status).toBe(200);
    expect(res.body.requests[0].documents).toEqual([{ id: 5, kind: 'dni_front', mime: 'image/jpeg', size: 1234 }]);
  });
  test('GET /admin/verifications trae los documentos y los datos cargados al aprobar', async () => {
    db.query.mockImplementation(defaultQuery(async (sql) => {
      if (/FROM verification_requests v/.test(sql)) return { rowCount: 1, rows: [{ id: 11, type: 'identity', status: 'pending', user_id: 7, user_name: 'Pedro', user_email: 'p@test.com', document_name: null, document_number: null, credential: null }] };
      if (/FROM verification_documents/.test(sql)) return { rowCount: 2, rows: [{ id: 5, request_id: 11, kind: 'dni_front', mime: 'image/jpeg', size: 10 }, { id: 6, request_id: 11, kind: 'selfie', mime: 'image/jpeg', size: 10 }] };
    }));
    const res = await request(app).get('/admin/verifications?status=pending').set('Authorization', `Bearer ${tokenFor(1, 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.requests[0].documents.map(d => d.kind)).toEqual(['dni_front', 'selfie']);
  });
  test('GET /admin/verification-documents/:id devuelve el archivo solo a un admin', async () => {
    db.query.mockImplementation(defaultQuery(async (sql) => /FROM verification_documents WHERE id/.test(sql)
      ? { rowCount: 1, rows: [{ mime: 'image/png', bytes: Buffer.from('fake-png-bytes') }] } : undefined));
    const noAdmin = await request(app).get('/admin/verification-documents/5').set('Authorization', `Bearer ${tokenFor(7)}`);
    expect(noAdmin.status).toBe(403);
    const res = await request(app).get('/admin/verification-documents/5').set('Authorization', `Bearer ${tokenFor(1, 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.body.toString()).toBe('fake-png-bytes');
  });
  test('documento inexistente o ya borrado → 404', async () => {
    const res = await request(app).get('/admin/verification-documents/999').set('Authorization', `Bearer ${tokenFor(1, 'admin')}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /admin/verifications/:id/review con documentos', () => {
  const wire = (type) => fakeClient(async (sql) => {
    if (/FROM verification_requests WHERE id = \$1/.test(sql)) return { rowCount: 1, rows: [{ id: 11, user_id: 7, type, status: 'pending' }] };
  });
  beforeEach(() => {
    db.query.mockImplementation(defaultQuery(async (sql) => /SELECT email, name FROM users/.test(sql)
      ? { rowCount: 1, rows: [{ email: 'p@test.com', name: 'Pedro' }] } : undefined));
  });
  test('aprobar identidad sin nombre y DNI → 400 y nada cambia', async () => {
    const client = wire('identity');
    const res = await request(app).post('/admin/verifications/11/review').set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)
      .send({ decision: 'approve' });
    expect(res.status).toBe(400);
    expect(client.sqls.some(q => /UPDATE users/.test(q.sql))).toBe(false);
    expect(client.sqls.map(q => q.sql)).toContain('ROLLBACK');
  });
  test('aprobar título sin el nombre del título → 400', async () => {
    wire('professional');
    const res = await request(app).post('/admin/verifications/11/review').set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)
      .send({ decision: 'approve' });
    expect(res.status).toBe(400);
  });
  test('aprobar identidad con datos → insignia, datos guardados, archivos borrados, mail', async () => {
    const client = wire('identity');
    const res = await request(app).post('/admin/verifications/11/review').set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)
      .send({ decision: 'approve', document_name: 'Pedro Pérez', document_number: '30.123.456' });
    expect(res.status).toBe(200);
    const upd = client.sqls.find(q => /UPDATE verification_requests/.test(q.sql));
    expect(upd.params).toEqual(expect.arrayContaining(['Pedro Pérez', '30.123.456']));
    expect(client.sqls.some(q => /^\s*DELETE FROM verification_documents/i.test(q.sql))).toBe(true);
    expect(client.sqls.some(q => /UPDATE users SET verified_identity = true/.test(q.sql))).toBe(true);
    expect(client.sqls.map(q => q.sql)).toContain('COMMIT');
    await flush();
    expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'p@test.com', subject: expect.stringMatching(/aprobada/i) }));
  });
  test('rechazar → archivos borrados y mail con el motivo', async () => {
    const client = wire('professional');
    const res = await request(app).post('/admin/verifications/11/review').set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)
      .send({ decision: 'reject', admin_note: 'El título no se lee' });
    expect(res.status).toBe(200);
    expect(client.sqls.some(q => /^\s*DELETE FROM verification_documents/i.test(q.sql))).toBe(true);
    await flush();
    expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'p@test.com', subject: expect.stringMatching(/revisión/i) }));
    const call = email.sendEmail.mock.calls[0][0];
    expect(call.text).toContain('El título no se lee');
  });
});
