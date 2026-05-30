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
const { _resetStoreForTests } = require('../src/middleware/rateLimiter');

// Reset del rate limiter antes de cada test — todas las requests vienen de
// 127.0.0.1 (jest --runInBand) y se sumarían rápido, haciendo que algunos
// tests prueben "429" en lugar del comportamiento real del controller.
beforeEach(() => {
  _resetStoreForTests();
});

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
    expect(res.status).toBe(400);
  });

  test('POST /auth/register con password débil → 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ name: 'Test', email: `weak${Date.now()}@example.com`, password: '123' });
    expect(res.status).toBe(400);
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

// ============================================================
// Security headers — verifica que securityHeaders middleware aplica
// los headers correctos a cualquier response. Si alguno se cae
// silenciosamente (alguien removió el middleware), este test lo agarra.
// ============================================================
describe('Smoke — security headers en respuestas', () => {
  test('GET / setea headers de seguridad esperados', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(res.headers['permissions-policy']).toMatch(/geolocation=\(\)/);
  });

  test('GET / NO expone X-Powered-By', async () => {
    const res = await request(app).get('/');
    // securityHeaders.js hace res.removeHeader('X-Powered-By').
    // Si alguien activa app.disable('x-powered-by') no aplica para
    // requests internos, así que este test es la red de seguridad.
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('Endpoints de rate limit exponen headers X-RateLimit-*', async () => {
    const res = await request(app).get('/products');
    expect(res.headers).toHaveProperty('x-ratelimit-limit');
    expect(res.headers).toHaveProperty('x-ratelimit-remaining');
    expect(res.headers).toHaveProperty('x-ratelimit-reset');
  });
});

// ============================================================
// Admin endpoints — todos los listados de admin deben rechazar
// requests sin auth. La idea es que un crawler que descubra /admin/*
// no pueda leer NADA, ni siquiera saber qué endpoints existen.
// ============================================================
describe('Smoke — admin endpoints rechazan sin token', () => {
  const endpoints = [
    'GET  /admin/users',
    'GET  /admin/products',
    'GET  /admin/orders',
    'GET  /admin/reviews',
    'GET  /admin/reports',
  ];

  endpoints.forEach(line => {
    const [method, path] = line.split(/\s+/);
    test(`${method.trim()} ${path} sin token → 401`, async () => {
      const res = await request(app)[method.trim().toLowerCase()](path);
      expect([401, 403]).toContain(res.status);
    });
  });

  test('PATCH /admin/users/1 sin token → 401', async () => {
    const res = await request(app)
      .patch('/admin/users/1')
      .send({ role: 'admin' });
    expect([401, 403]).toContain(res.status);
  });

  test('DELETE /admin/reviews/1 sin token → 401', async () => {
    const res = await request(app).delete('/admin/reviews/1');
    expect([401, 403]).toContain(res.status);
  });
});

// ============================================================
// Admin endpoints con JWT válido pero rol "user" → 403.
// El JWT_SECRET solo está en CI y dev; en producción local podría no estar.
// Si falta, skipeamos para que el test no sea frágil.
// ============================================================
describe('Smoke — admin endpoints rechazan a usuarios no-admin', () => {
  const jwt = require('jsonwebtoken');
  const hasSecret = !!process.env.JWT_SECRET;

  // No-admin token apunta a un user_id MUY alto (999999) que casi seguro
  // no existe → requireAdmin va a devolver 401 "Usuario no encontrado",
  // que también es válido para nuestro propósito (no expone /admin).
  const nonAdminToken = hasSecret
    ? jwt.sign({ id: 999999, email: 'fake@test.com', role: 'user' }, process.env.JWT_SECRET, { expiresIn: '5m' })
    : null;

  (hasSecret ? test : test.skip)('GET /admin/stats con token rol=user → 401/403 (nunca 200)', async () => {
    const res = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Bearer ${nonAdminToken}`);
    expect([401, 403]).toContain(res.status);
  });

  (hasSecret ? test : test.skip)('GET /admin/users con token rol=user → 401/403 (nunca 200)', async () => {
    const res = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${nonAdminToken}`);
    expect([401, 403]).toContain(res.status);
  });
});

// ============================================================
// Reports endpoint — público para reportar problemas, pero
// SIEMPRE validado (categoría, longitud mínima, etc.).
// ============================================================
describe('Smoke — POST /reports validación', () => {
  test('POST /reports sin body → 400', async () => {
    const res = await request(app).post('/reports').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/category|body/i);
  });

  test('POST /reports con category inválida → 400', async () => {
    const res = await request(app)
      .post('/reports')
      .send({ category: 'invalid_xyz', body: 'Mensaje suficientemente largo' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/categor/i);
  });

  test('POST /reports con body muy corto → 400', async () => {
    const res = await request(app)
      .post('/reports')
      .send({ category: 'technical', body: 'corto' });
    expect(res.status).toBe(400);
  });
});

// ============================================================
// Auth flow — login, forgot-password, reset-password edge cases.
// Cuidado con el authLimiter (max 10 requests / 15 min por IP).
// El archivo entero corre con --runInBand, así que sumamos los POSTs.
// ============================================================
describe('Smoke — /auth/login validación', () => {
  test('POST /auth/login sin body → 400', async () => {
    const res = await request(app).post('/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email|contraseña/i);
  });

  test('POST /auth/login con email inexistente → 401 genérico', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: `nonexistent-${Date.now()}@test.com`, password: 'whatever123' });
    // 401 "Credenciales inválidas" — mismo mensaje que cuando el password
    // es incorrecto. Si algún día devolviera 404 o un mensaje distinto,
    // un atacante podría enumerar emails registrados. Este test lo agarra.
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/credenciales/i);
  });
});

describe('Smoke — /auth/forgot-password no enumera emails', () => {
  test('POST /auth/forgot-password sin email → 400', async () => {
    const res = await request(app).post('/auth/forgot-password').send({});
    expect(res.status).toBe(400);
  });

  test('POST /auth/forgot-password con email inexistente → 200 genérico', async () => {
    const res = await request(app)
      .post('/auth/forgot-password')
      .send({ email: `nonexistent-${Date.now()}@test.com` });
    // CRÍTICO: tiene que devolver 200 con mensaje genérico para no
    // permitir enumerar qué emails están registrados en la DB.
    // Si algún día devuelve 404 o un mensaje específico de "no existe",
    // hay una fuga de info y este test falla.
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/email/i);
  });
});

describe('Smoke — /auth/reset-password validación', () => {
  test('POST /auth/reset-password sin body → 400', async () => {
    const res = await request(app).post('/auth/reset-password').send({});
    expect(res.status).toBe(400);
  });

  test('POST /auth/reset-password con token inválido → 400 (no 401, no 500)', async () => {
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token: 'token-falso-que-no-existe', new_password: 'PasswordValido123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token/i);
  });
});

// ============================================================
// Sitemaps — además de products, services e index también deben existir
// y ser XML válido. Si alguno se cae, perdemos SEO de esa sección.
// ============================================================
describe('Smoke — sitemaps adicionales', () => {
  test('GET /sitemap-services.xml devuelve XML', async () => {
    const res = await request(app).get('/sitemap-services.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/i);
    expect(res.text).toMatch(/<\?xml/);
  });

  test('GET /sitemap.xml (index) devuelve XML', async () => {
    const res = await request(app).get('/sitemap.xml');
    // El index puede existir o no según implementación. Si existe, debe ser XML.
    if (res.status === 200) {
      expect(res.headers['content-type']).toMatch(/xml/i);
    } else {
      expect(res.status).toBe(404);
    }
  });
});

// ============================================================
// /auth/google — Google Sign-In endpoint
// Verificamos los caminos de error sin necesidad de tokens reales de Google
// (sería frágil mockear google-auth-library en CI). Sí cubrimos:
//   - validación de input (sin credential → 400)
//   - no-config (sin GOOGLE_CLIENT_ID → 503)
//   - token inválido (firma rota → 401)
// El happy path requiere un ID token real de Google, lo dejamos para QA manual.
// ============================================================
describe('Smoke — POST /auth/google validación de inputs', () => {
  test('POST /auth/google sin credential → 400', async () => {
    const res = await request(app).post('/auth/google').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /auth/google con credential null → 400', async () => {
    const res = await request(app).post('/auth/google').send({ credential: null });
    expect(res.status).toBe(400);
  });

  test('POST /auth/google con credential string vacío → 400', async () => {
    const res = await request(app).post('/auth/google').send({ credential: '' });
    expect(res.status).toBe(400);
  });

  test('POST /auth/google con credential basura → 401 ó 503 (no 500)', async () => {
    // 503 si GOOGLE_CLIENT_ID no está seteado en el env del test
    // 401 si está seteado pero el token es inválido (firma rota)
    // Ambos son aceptables — lo que NO queremos es 500 ni que crashee el server
    const res = await request(app)
      .post('/auth/google')
      .send({ credential: 'not.a.valid.jwt' });
    expect([401, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('error');
  });
});

// ============================================================
// Catálogo público — GET /products con filtros raros no debe romper.
// Defensa contra crashes por inputs maliciosos en query strings.
// ============================================================
describe('Smoke — /products tolera filtros raros sin crashear', () => {
  test('GET /products?category=<script> no rompe', async () => {
    const res = await request(app).get('/products?category=%3Cscript%3E');
    expect(res.status).toBeLessThan(500);
  });

  test('GET /products?page=-1 no rompe', async () => {
    const res = await request(app).get('/products?page=-1');
    expect(res.status).toBeLessThan(500);
  });

  test('GET /products?sort=DROP_TABLE no rompe', async () => {
    const res = await request(app).get('/products?sort=DROP_TABLE');
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
