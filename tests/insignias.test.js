/**
 * Insignias de usuario y carteles de publicaciones (migración 019).
 *  - Carteles: hasta 2 por publicación, texto corto escapado, color hex (o el
 *    default); se guardan al crear/editar productos y servicios y salen en los
 *    listados y las fichas junto con las insignias del vendedor.
 *  - Insignias: el admin las asigna con claves conocidas; puede ponerse las
 *    suyas pero no suspenderse a sí mismo.
 *  - Sin la migración aplicada (42703) los GET y los POST/PUT siguen andando
 *    sin la columna; asignar insignias avisa con 503.
 * La base va mockeada.
 */
jest.mock('../src/config/database', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
jest.mock('../src/services/email', () => {
  const actual = jest.requireActual('../src/services/email');
  return { ...actual, sendEmail: jest.fn() };
});

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const db      = require('../src/config/database');
const app     = require('../src/index');
const { _resetStoreForTests } = require('../src/middleware/rateLimiter');
const { normalizePostBadges, normalizeUserBadges, withoutMigration019 } = require('../src/services/badges');

const tokenFor = (id, role = 'user') =>
  jwt.sign({ id, email: `u${id}@test.com`, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
const USER  = tokenFor(7);
const ADMIN = tokenFor(1, 'admin');

// Base mínima para lo que no es el tema del test (auth, admin, dueño, verificación).
function baseQuery(sql, params) {
  if (/SELECT is_active FROM users WHERE id/.test(sql)) return { rows: [{ is_active: true }] };
  if (/SELECT role, is_active FROM users/.test(sql)) return { rows: [{ role: params && params[0] === 1 ? 'admin' : 'user', is_active: true }] };
  if (/SELECT verified_identity, verified_professional FROM users/.test(sql)) return { rows: [{ verified_identity: true, verified_professional: true }] };
  if (/SELECT seller_id, status FROM products/.test(sql)) return { rows: [{ seller_id: 7, status: 'active' }] };
  if (/SELECT provider_id, status FROM services/.test(sql)) return { rows: [{ provider_id: 7, status: 'active' }] };
  if (/SELECT COUNT\(\*\)/.test(sql)) return { rows: [{ count: '1', total: 1 }] };
  return { rows: [{ id: 1 }], rowCount: 1 };
}
const missingColumn = () => { const e = new Error('column "badges" does not exist'); e.code = '42703'; return e; };
const calls = () => db.query.mock.calls;
const find  = (re) => calls().find(([sql]) => re.test(sql));
const auth  = (token) => ({ Authorization: `Bearer ${token}` });

beforeEach(() => {
  db.query.mockReset();
  db.query.mockImplementation(async (sql, params) => baseQuery(sql, params));
  _resetStoreForTests();
});

describe('normalizadores', () => {
  test('carteles: escapa el texto, baja el color a minúsculas y pone el default si no es hex', () => {
    const r = normalizePostBadges([{ text: ' Garantía & más ', color: '#ABCDEF' }, { text: 'x', color: 'red' }]);
    expect(r).toEqual({ ok: true, badges: [{ text: 'Garantía &amp; más', color: '#abcdef' }, { text: 'x', color: '#ef4444' }] });
  });
  test('carteles: el vacío se saltea; más de 2, más de 20 caracteres o sin texto no pasan', () => {
    expect(normalizePostBadges([{ text: '  ' }])).toEqual({ ok: true, badges: [] });
    expect(normalizePostBadges(undefined)).toEqual({ ok: true, badges: [] });
    expect(normalizePostBadges([{ text: 'a' }, { text: 'b' }, { text: 'c' }]).ok).toBe(false);
    expect(normalizePostBadges([{ text: 'x'.repeat(21) }]).ok).toBe(false);
    expect(normalizePostBadges('ENVÍO GRATIS').ok).toBe(false);
    expect(normalizePostBadges([{ color: '#fff' }]).ok).toBe(false);
  });
  test('insignias: solo claves conocidas, sin repetir', () => {
    expect(normalizeUserBadges(['fundador', 'ceo', 'fundador'])).toEqual({ ok: true, badges: ['fundador', 'ceo'] });
    expect(normalizeUserBadges(['verificado']).ok).toBe(false); // sale de la verificación, no se asigna a mano
    expect(normalizeUserBadges(['ceo', 42]).ok).toBe(false);
    expect(normalizeUserBadges('ceo').ok).toBe(false);
  });
  test('withoutMigration019 saca solo las líneas marcadas', () => {
    expect(withoutMigration019('SELECT a,\n  b, /*019*/\n  c FROM t')).toBe('SELECT a,\n  c FROM t');
  });
});

describe('carteles en productos', () => {
  const body = { title: 'Taladro', price: 1000, badges: [{ text: 'GARANTÍA 1 AÑO', color: '#10B981' }, { text: '' }] };

  test('POST /products guarda los carteles normalizados', async () => {
    const r = await request(app).post('/products').set(auth(USER)).send(body);
    expect(r.status).toBe(201);
    const ins = find(/INSERT INTO products/);
    expect(ins[0]).toMatch(/\$16::jsonb \/\*019\*\//);
    expect(ins[1]).toHaveLength(16);
    expect(JSON.parse(ins[1][15])).toEqual([{ text: 'GARANTÍA 1 AÑO', color: '#10b981' }]);
  });

  test('POST /products sin carteles guarda una lista vacía', async () => {
    const r = await request(app).post('/products').set(auth(USER)).send({ title: 'Taladro', price: 1000 });
    expect(r.status).toBe(201);
    expect(find(/INSERT INTO products/)[1][15]).toBe('[]');
  });

  test('POST /products con 3 carteles o texto largo → 400', async () => {
    let r = await request(app).post('/products').set(auth(USER))
      .send({ title: 'Taladro', price: 1000, badges: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Máximo 2 carteles/);
    r = await request(app).post('/products').set(auth(USER))
      .send({ title: 'Taladro', price: 1000, badges: [{ text: 'x'.repeat(21) }] });
    expect(r.status).toBe(400);
    expect(find(/INSERT INTO products/)).toBeUndefined();
  });

  test('POST /products sin la migración: reintenta sin la columna', async () => {
    let n = 0;
    db.query.mockImplementation(async (sql, params) => {
      if (/INSERT INTO products/.test(sql) && n++ === 0) throw missingColumn();
      return baseQuery(sql, params);
    });
    const r = await request(app).post('/products').set(auth(USER)).send(body);
    expect(r.status).toBe(201);
    const inserts = calls().filter(([sql]) => /INSERT INTO products/.test(sql));
    expect(inserts).toHaveLength(2);
    expect(inserts[1][0]).not.toMatch(/019|badges/);
    expect(inserts[1][1]).toHaveLength(15);
  });

  test('PUT /products/:id pisa los carteles solo si vienen en el pedido', async () => {
    let r = await request(app).put('/products/3').set(auth(USER)).send({ badges: [{ text: 'OFERTA', color: '#000' }] });
    expect(r.status).toBe(200);
    let up = find(/UPDATE products SET/);
    expect(up[0]).toMatch(/badges\s+= COALESCE\(\$16::jsonb, badges\), \/\*019\*\//);
    expect(JSON.parse(up[1][15])).toEqual([{ text: 'OFERTA', color: '#000' }]);

    db.query.mockClear();
    r = await request(app).put('/products/3').set(auth(USER)).send({ title: 'Otro título' });
    expect(r.status).toBe(200);
    up = find(/UPDATE products SET/);
    expect(up[1][15]).toBeNull();
  });

  test('GET /products y /products/:id traen carteles e insignias del vendedor', async () => {
    db.query.mockImplementation(async (sql, params) =>
      (/FROM products p/.test(sql) && !/^\s*SELECT COUNT/.test(sql))
        ? { rows: [{ id: 3, badges: [{ text: 'OFERTA', color: '#000' }], seller_badges: ['fundador'], seller_verified_identity: true }] }
        : baseQuery(sql, params));
    let r = await request(app).get('/products?limit=2');
    expect(r.status).toBe(200);
    expect(r.body.data[0].seller_badges).toEqual(['fundador']);
    expect(r.body.data[0].badges[0].text).toBe('OFERTA');
    const list = find(/FROM products p/)[0];
    expect(list).toMatch(/p\.badges, \/\*019\*\//);
    expect(list).toMatch(/u\.badges AS seller_badges, \/\*019\*\//);
    expect(list).toMatch(/u\.verified_identity AS seller_verified_identity/);

    r = await request(app).get('/products/3');
    expect(r.status).toBe(200);
    expect(r.body.seller_verified_identity).toBe(true);
    expect(calls().filter(([sql]) => /u\.badges AS seller_badges/.test(sql))).toHaveLength(2);
  });

  test('GET /products sin la migración: repite la consulta sin las columnas nuevas', async () => {
    let n = 0;
    db.query.mockImplementation(async (sql, params) => {
      if (/FROM products p/.test(sql) && !/^\s*SELECT COUNT/.test(sql)) {
        if (n++ === 0) throw missingColumn();
        return { rows: [{ id: 3 }] };
      }
      return baseQuery(sql, params);
    });
    const r = await request(app).get('/products?limit=3');
    expect(r.status).toBe(200);
    const lists = calls().filter(([sql]) => /FROM products p/.test(sql) && !/^\s*SELECT COUNT/.test(sql));
    expect(lists).toHaveLength(2);
    expect(lists[1][0]).not.toMatch(/019|seller_badges|p\.badges/);
    expect(lists[1][1]).toEqual(lists[0][1]);
  });
});

describe('carteles en servicios', () => {
  test('POST /services guarda los carteles (prestador verificado)', async () => {
    const r = await request(app).post('/services').set(auth(USER))
      .send({ title: 'Plomería', price_from: 5000, badges: [{ text: 'EMERGENCIAS 24H', color: '#EF4444' }] });
    expect(r.status).toBe(201);
    const ins = find(/INSERT INTO services/);
    expect(ins[0]).toMatch(/\$12::jsonb \/\*019\*\//);
    expect(ins[1]).toHaveLength(12);
    expect(JSON.parse(ins[1][11])).toEqual([{ text: 'EMERGENCIAS 24H', color: '#ef4444' }]);
  });

  test('PUT /services/:id guarda los carteles', async () => {
    const r = await request(app).put('/services/4').set(auth(USER)).send({ badges: [{ text: 'MATRICULADO' }] });
    expect(r.status).toBe(200);
    const up = find(/UPDATE services SET/);
    expect(up[0]).toMatch(/badges\s+= COALESCE\(\$12::jsonb, badges\), \/\*019\*\//);
    expect(JSON.parse(up[1][11])).toEqual([{ text: 'MATRICULADO', color: '#ef4444' }]);
  });

  test('GET /services y /services/:id traen las insignias del prestador', async () => {
    await request(app).get('/services?limit=2');
    await request(app).get('/services/4');
    const sqls = calls().map(([sql]) => sql).filter((s) => /u\.badges\s+AS provider_badges, \/\*019\*\//.test(s));
    expect(sqls).toHaveLength(2);
    expect(sqls[0]).toMatch(/s\.badges, \/\*019\*\//);
  });
});

describe('insignias de usuario (admin)', () => {
  test('PATCH /admin/users/:id guarda las insignias válidas sin repetir', async () => {
    const r = await request(app).patch('/admin/users/5').set(auth(ADMIN)).send({ badges: ['fundador', 'ceo', 'fundador'] });
    expect(r.status).toBe(200);
    const up = find(/UPDATE users/);
    expect(up[0]).toMatch(/badges\s+= COALESCE\(\$4::jsonb, badges\), \/\*019\*\//);
    expect(up[1]).toEqual([null, null, '5', '["fundador","ceo"]']);
  });

  test('insignia desconocida → 400 y no toca la base', async () => {
    const r = await request(app).patch('/admin/users/5').set(auth(ADMIN)).send({ badges: ['pirata'] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Insignia desconocida/);
    expect(find(/UPDATE users/)).toBeUndefined();
  });

  test('el admin puede ponerse insignias pero no suspenderse ni cambiarse el rol', async () => {
    let r = await request(app).patch('/admin/users/1').set(auth(ADMIN)).send({ badges: ['ceo'] });
    expect(r.status).toBe(200);
    r = await request(app).patch('/admin/users/1').set(auth(ADMIN)).send({ is_active: false });
    expect(r.status).toBe(400);
    r = await request(app).patch('/admin/users/1').set(auth(ADMIN)).send({ role: 'user' });
    expect(r.status).toBe(400);
  });

  test('sin la migración: asignar insignias avisa con 503, suspender sigue andando', async () => {
    let n = 0;
    db.query.mockImplementation(async (sql, params) => {
      if (/UPDATE users/.test(sql) && /019/.test(sql)) { n++; throw missingColumn(); }
      return baseQuery(sql, params);
    });
    let r = await request(app).patch('/admin/users/5').set(auth(ADMIN)).send({ badges: ['ceo'] });
    expect(r.status).toBe(503);
    r = await request(app).patch('/admin/users/5').set(auth(ADMIN)).send({ is_active: false });
    expect(r.status).toBe(200);
    const ups = calls().filter(([sql]) => /UPDATE users/.test(sql));
    expect(ups).toHaveLength(3); // con insignias (falla), suspender (falla) y el reintento sin la 019
    expect(ups[2][0]).not.toMatch(/019|badges/);
    expect(ups[2][1]).toEqual([false, null, '5']);
  });

  test('GET /admin/users devuelve insignias y verificación de cada usuario', async () => {
    db.query.mockImplementation(async (sql, params) =>
      /^\s*SELECT id, name, email, phone/.test(sql)
        ? { rows: [{ id: 5, name: 'Dylan', badges: ['ceo'], verified_identity: true, verified_professional: false }] }
        : baseQuery(sql, params));
    const r = await request(app).get('/admin/users').set(auth(ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.data[0].badges).toEqual(['ceo']);
    expect(find(/^\s*SELECT id, name, email, phone/)[0]).toMatch(/verified_identity, verified_professional,\s+badges, \/\*019\*\//);
  });

  test('un usuario común no asigna insignias', async () => {
    const r = await request(app).patch('/admin/users/5').set(auth(USER)).send({ badges: ['ceo'] });
    expect(r.status).toBe(403);
  });
});
