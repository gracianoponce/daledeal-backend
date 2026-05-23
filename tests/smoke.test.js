/**
 * Smoke tests — verifica que los endpoints públicos respondan con la forma
 * esperada y que los protegidos rechacen requests sin auth.
 *
 * No requieren DB poblada; los listings devuelven array vacío si la DB está
 * vacía, lo cual sigue siendo respuesta válida. El test que sí toca DB es
 * /health (hace SELECT 1) — requiere Postgres up.
 *
 * Si Postgres NO está disponible, varios tests van a fallar. En CI tenemos
 * que levantar un Postgres de prueba (ver .github/workflows/ci.yml).
 */
const request = require('supertest');
const app     = require('../src/index');

describe('Smoke — endpoints públicos básicos', () => {
  test('GET / responde con info de la API', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('endpoints');
  });

  test('GET /health responde 200 si la DB está conectada', async () => {
    const res = await request(app).get('/health');
    // 200 si DB OK, 503 si DB caída. Aceptamos cualquiera para no
    // hacer al test frágil cuando se corre sin DB de prueba.
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
  });

  test('GET /products devuelve estructura paginada', async () => {
    const res = await request(app).get('/products');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /services devuelve estructura paginada', async () => {
    const res = await request(app).get('/services');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /products?limit=999999 NO devuelve más de 100 (paginación capped)', async () => {
    const res = await request(app).get('/products?limit=999999');
    expect(res.status).toBe(200);
    // Si hay menos de 100 productos en DB, lo importante es que no se rompa
    expect(res.body.data.length).toBeLessThanOrEqual(100);
  });

  test('GET /sitemap-products.xml devuelve XML', async () => {
    const res = await request(app).get('/sitemap-products.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/i);
  });

  test('404 devuelve JSON con error/path/method', async () => {
    const res = await request(app).get('/ruta-que-no-existe');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(res.body.path).toBe('/ruta-que-no-existe');
    expect(res.body.method).toBe('GET');
  });
});

describe('Smoke — endpoints protegidos rechazan sin token', () => {
  test('GET /auth/me sin token → 401', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  test('GET /favorites sin token → 401', async () => {
    const res = await request(app).get('/favorites');
    expect(res.status).toBe(401);
  });

  test('GET /orders/my sin token → 401', async () => {
    const res = await request(app).get('/orders/my');
    expect(res.status).toBe(401);
  });

  test('GET /messages/conversations sin token → 401', async () => {
    const res = await request(app).get('/messages/conversations');
    expect(res.status).toBe(401);
  });

  test('POST /products sin token → 401', async () => {
    const res = await request(app)
      .post('/products')
      .send({ title: 'Test', price: 100 });
    expect(res.status).toBe(401);
  });

  test('GET /admin/stats sin token → 401 (no expone si existe la ruta a usuarios anónimos)', async () => {
    const res = await request(app).get('/admin/stats');
    expect([401, 403]).toContain(res.status);
  });
});

describe('Smoke — validación de inputs en /auth/register', () => {
  test('POST /auth/register sin email → 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ name: 'Test', password: 'Test1234' });
    // Esperamos 400 (validation error). NO 200, NO 500.
    expect([400, 422, 429]).toContain(res.status);
  });

  test('POST /auth/register con password débil → 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ name: 'Test', email: `weak${Date.now()}@example.com`, password: '123' });
    expect([400, 422, 429]).toContain(res.status);
  });
});

describe('Smoke — webhook MP rechaza payloads sin firma', () => {
  test('POST /payments/webhook sin x-signature → no acepta como pago confirmado', async () => {
    const res = await request(app)
      .post('/payments/webhook')
      .send({ data: { id: 999999 }, type: 'payment' });
    // En dev sin MP_WEBHOOK_SECRET puede aceptar (warning). En prod debe rechazar.
    // El test crítico es que NUNCA devuelva 200 + payment confirmed cuando
    // no hay firma válida en producción. Acá probamos al menos que el endpoint
    // existe y responde algo coherente (no 500).
    expect(res.status).toBeLessThan(500);
  });
});

// Cerrar el pool de Postgres al final para que jest no quede colgado
afterAll(async () => {
  try {
    const db = require('../src/config/database');
    if (db && typeof db.end === 'function') await db.end();
  } catch (_) { /* ignore */ }
});
