/**
 * Tests de `trust proxy` + rate limiting por IP real.
 *
 * En Railway la app corre detrás de un proxy: sin `app.set('trust proxy', 1)`,
 * req.ip es la IP interna del edge (100.64.x.x) para TODOS los clientes y el
 * rate limiter usa una única key compartida — castiga a usuarios legítimos y
 * no aísla atacantes. Estos tests fallan si alguien borra esa línea.
 *
 * No requieren DB: si Postgres no está, el login devuelve 4xx/5xx — cualquier
 * cosa distinta de 429 sirve para distinguir "bloqueado" de "no bloqueado".
 */
const request = require('supertest');
const app     = require('../src/index');
const { _resetStoreForTests } = require('../src/middleware/rateLimiter');

beforeEach(() => {
  _resetStoreForTests();
});

describe('trust proxy + rate limiter por IP real', () => {
  test('la app confía en el primer salto del proxy', () => {
    expect(app.get('trust proxy')).toBe(1);
  });

  test('req.ip toma X-Forwarded-For (el limiter NO comparte key entre clientes)', async () => {
    // Agotar la ventana del authLimiter (max 10 / 15 min) para la IP 9.9.9.1
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', '9.9.9.1')
        .send({ email: 'a@a.com', password: 'x' });
    }
    const bloqueada = await request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', '9.9.9.1')
      .send({ email: 'a@a.com', password: 'x' });
    expect(bloqueada.status).toBe(429);

    // Otro cliente (otra IP) NO debe estar bloqueado. Sin trust proxy, ambos
    // compartirían la key del proxy y esto daría 429 → el test fallaría.
    const otroCliente = await request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', '9.9.9.2')
      .send({ email: 'a@a.com', password: 'x' });
    expect(otroCliente.status).not.toBe(429);
  });
});
