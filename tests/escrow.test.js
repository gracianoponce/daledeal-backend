/**
 * Tests del circuito escrow (retención/liberación de pagos).
 *
 * Verifican cableado + protección de auth sin depender de la migration 015
 * (no requieren DB poblada): los endpoints deben rechazar requests sin token.
 */
const request = require('supertest');
const app     = require('../src/index');
const { _resetStoreForTests } = require('../src/middleware/rateLimiter');

beforeEach(() => {
  _resetStoreForTests();
});

describe('Escrow — auth', () => {
  test('POST /orders/1/confirm-delivery sin token → 401', async () => {
    const res = await request(app).post('/orders/1/confirm-delivery');
    expect(res.status).toBe(401);
  });

  test('GET /admin/payouts/pending sin token → 401', async () => {
    const res = await request(app).get('/admin/payouts/pending');
    expect(res.status).toBe(401);
  });

  test('POST /admin/orders/1/release sin token → 401', async () => {
    const res = await request(app).post('/admin/orders/1/release').send({ note: 'test' });
    expect(res.status).toBe(401);
  });

  test('POST /admin/orders/1/hold sin token → 401', async () => {
    const res = await request(app).post('/admin/orders/1/hold').send({ hold: true });
    expect(res.status).toBe(401);
  });
});
