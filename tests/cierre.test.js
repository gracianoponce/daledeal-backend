/**
 * Tests del cierre para el lanzamiento:
 *  - sanitize conserva los saltos de línea en los campos de texto libre.
 *  - PUT /users/me permite borrar teléfono y ubicación.
 *  - Mis publicaciones no trae lo borrado.
 *  - El admin puede listar los mensajes de contacto.
 * La base va mockeada.
 */
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  pool:  { connect: jest.fn() },
}));

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const db      = require('../src/config/database');
const app     = require('../src/index');
const { sanitize } = require('../src/middleware/validate');
const { _resetStoreForTests } = require('../src/middleware/rateLimiter');

const tokenFor = (id, role = 'user') =>
  jwt.sign({ id, email: `u${id}@test.com`, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
const AUTH_SQL = /SELECT is_active FROM users WHERE id/;
const sqls = () => db.query.mock.calls.map(([sql]) => sql).filter(sql => !AUTH_SQL.test(sql));

beforeEach(() => {
  _resetStoreForTests();
  db.query.mockReset();
  db.query.mockResolvedValue({ rowCount: 0, rows: [] });
});

// ------------------------------------------------------------
describe('sanitize con varias líneas', () => {
  test('texto libre: conserva los saltos (máx. 2 seguidos) y escapa igual', () => {
    expect(sanitize('  Hola,\r\n\r\n\r\n\r\nte   escribo <b>ya</b>.\n  Gracias  ', { multiline: true }))
      .toBe('Hola,\n\nte escribo &lt;b&gt;ya&lt;/b&gt;.\nGracias');
  });

  test('campos de una línea: todo el espacio en blanco sigue colapsando', () => {
    expect(sanitize('Título   con\nsalto')).toBe('Título con salto');
  });

  test('el cuerpo de un reporte llega al controller con sus saltos y el asunto no', async () => {
    db.query.mockImplementation(async (sql) => (/INSERT INTO problem_reports/i.test(sql)
      ? { rowCount: 1, rows: [{ id: 1, category: 'other', status: 'open', created_at: new Date() }] }
      : { rowCount: 0, rows: [] }));
    const res = await request(app).post('/reports')
      .send({ category: 'other', subject: 'Una\nlínea', body: 'Primera línea\nSegunda línea' });
    expect(res.status).toBe(201);
    const insert = db.query.mock.calls.find(([sql]) => /INSERT INTO problem_reports/i.test(sql));
    expect(insert[1]).toContain('Primera línea\nSegunda línea');
    expect(insert[1]).toContain('Una línea');
  });
});

// ------------------------------------------------------------
describe('PUT /users/me', () => {
  test('teléfono y ubicación vacíos se borran (antes no se podían quitar)', async () => {
    db.query.mockImplementation(async (sql) => (/UPDATE users SET/i.test(sql)
      ? { rowCount: 1, rows: [{ id: 7, name: 'Ana', phone: null, location: null }] }
      : { rowCount: 0, rows: [] }));
    const res = await request(app).put('/users/me').set('Authorization', `Bearer ${tokenFor(7)}`)
      .send({ name: 'Ana', phone: '', location: '' });
    expect(res.status).toBe(200);
    const update = db.query.mock.calls.find(([sql]) => /UPDATE users SET/i.test(sql));
    expect(update[0]).toMatch(/WHEN \$2 = '' THEN NULL/);
    expect(update[1].slice(0, 3)).toEqual(['Ana', '', '']);
  });

  test('un campo que no viene queda como está', async () => {
    db.query.mockImplementation(async (sql) => (/UPDATE users SET/i.test(sql)
      ? { rowCount: 1, rows: [{ id: 7, name: 'Ana' }] }
      : { rowCount: 0, rows: [] }));
    await request(app).put('/users/me').set('Authorization', `Bearer ${tokenFor(7)}`).send({ name: 'Ana' });
    const update = db.query.mock.calls.find(([sql]) => /UPDATE users SET/i.test(sql));
    expect(update[1].slice(1, 4)).toEqual([undefined, undefined, undefined]);
  });
});

// ------------------------------------------------------------
describe('Mis publicaciones', () => {
  test('GET /users/me/products no trae lo borrado', async () => {
    await request(app).get('/users/me/products').set('Authorization', `Bearer ${tokenFor(7)}`).expect(200);
    expect(sqls()[0]).toMatch(/p\.status <> 'deleted'/);
  });

  test('GET /users/me/services no trae lo borrado', async () => {
    await request(app).get('/users/me/services').set('Authorization', `Bearer ${tokenFor(7)}`).expect(200);
    expect(sqls()[0]).toMatch(/s\.status <> 'deleted'/);
  });
});

// ------------------------------------------------------------
describe('GET /admin/contact-messages', () => {
  const asAdmin = () => db.query.mockImplementation(async (sql) => {
    if (/SELECT role, is_active FROM users/i.test(sql)) return { rowCount: 1, rows: [{ role: 'admin', is_active: true }] };
    if (/count\(\*\)/i.test(sql)) return { rowCount: 1, rows: [{ total: 1 }] };
    if (/FROM contact_messages/i.test(sql)) {
      return { rowCount: 1, rows: [{ id: 3, nombre: 'Ana', email: 'ana@test.com', asunto: 'Consulta', mensaje: 'Hola', tipo: 'general' }] };
    }
    return { rowCount: 0, rows: [] };
  });

  test('el admin ve los mensajes, del más nuevo al más viejo', async () => {
    asAdmin();
    const res = await request(app).get('/admin/contact-messages').set('Authorization', `Bearer ${tokenFor(1, 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, page: 1 });
    expect(res.body.data[0]).toMatchObject({ nombre: 'Ana', mensaje: 'Hola' });
    const list = db.query.mock.calls.find(([sql]) => /SELECT id, nombre/i.test(sql));
    expect(list[0]).toMatch(/ORDER BY created_at DESC/);
  });

  test('filtra por tipo válido e ignora uno inventado', async () => {
    asAdmin();
    await request(app).get('/admin/contact-messages?tipo=empresa').set('Authorization', `Bearer ${tokenFor(1, 'admin')}`);
    expect(db.query.mock.calls.find(([sql]) => /SELECT id, nombre/i.test(sql))[1][0]).toBe('empresa');
    db.query.mockClear();
    asAdmin();
    await request(app).get("/admin/contact-messages?tipo=x'%20OR%201=1").set('Authorization', `Bearer ${tokenFor(1, 'admin')}`);
    expect(db.query.mock.calls.find(([sql]) => /SELECT id, nombre/i.test(sql))[0]).not.toMatch(/WHERE tipo/);
  });

  test('un usuario común no entra', async () => {
    db.query.mockImplementation(async (sql) => (/SELECT role, is_active FROM users/i.test(sql)
      ? { rowCount: 1, rows: [{ role: 'user', is_active: true }] } : { rowCount: 0, rows: [] }));
    const res = await request(app).get('/admin/contact-messages').set('Authorization', `Bearer ${tokenFor(7)}`);
    expect(res.status).toBe(403);
  });
});
