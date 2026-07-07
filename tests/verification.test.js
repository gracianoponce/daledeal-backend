/**
 * Tests de los endpoints de verificación de prestadores.
 *
 * Verifican el cableado + la protección de auth sin depender de que la
 * migration 013 esté aplicada (no requieren DB poblada): los endpoints
 * protegidos deben rechazar requests sin token.
 */
const request = require('supertest');
const app     = require('../src/index');
const { _resetStoreForTests } = require('../src/middleware/rateLimiter');

beforeEach(() => {
  _resetStoreForTests();
});

describe('Verificación de prestadores — auth', () => {
  test('POST /verifications sin token → 401', async () => {
    const res = await request(app).post('/verifications').send({ type: 'identity' });
    expect(res.status).toBe(401);
  });

  test('GET /verifications/me sin token → 401', async () => {
    const res = await request(app).get('/verifications/me');
    expect(res.status).toBe(401);
  });

  test('GET /admin/verifications sin token → 401', async () => {
    const res = await request(app).get('/admin/verifications');
    expect(res.status).toBe(401);
  });

  test('POST /admin/verifications/:id/review sin token → 401', async () => {
    const res = await request(app).post('/admin/verifications/1/review').send({ decision: 'approve' });
    expect(res.status).toBe(401);
  });
});
