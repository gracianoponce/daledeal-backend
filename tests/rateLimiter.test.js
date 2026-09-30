/**
 * Tests del rate limiter: cada limiter cuenta por separado.
 *
 * Bug de prelanzamiento: todos los limiters compartían un único contador por
 * IP. El apiLimiter (global, 200) sumaba cada request al mismo número que
 * miraba el authLimiter (10): después de ~10 requests cualquiera, el login
 * respondía 429 "Demasiados intentos de autenticación".
 */
const express = require('express');
const request = require('supertest');
const { createRateLimiter, _resetStoreForTests } = require('../src/middleware/rateLimiter');

function buildApp() {
  const app = express();
  const general = createRateLimiter({ windowMs: 60_000, max: 50 });
  const strict  = createRateLimiter({ windowMs: 60_000, max: 3, message: 'Demasiados intentos' });
  app.use(general);
  app.get('/browse', (req, res) => res.json({ ok: true }));
  app.post('/login', strict, (req, res) => res.json({ ok: true }));
  return app;
}

describe('rateLimiter', () => {
  beforeEach(() => _resetStoreForTests());

  test('navegar no consume los intentos del limiter estricto', async () => {
    const app = buildApp();
    for (let i = 0; i < 10; i++) {
      await request(app).get('/browse').expect(200);
    }
    // Con el contador compartido, esto ya daba 429 (10 > 3).
    const res = await request(app).post('/login').expect(200);
    expect(res.headers['x-ratelimit-limit']).toBe('3');
    expect(res.headers['x-ratelimit-remaining']).toBe('2');
  });

  test('el limiter estricto corta al pasar su propio máximo', async () => {
    const app = buildApp();
    for (let i = 0; i < 3; i++) {
      await request(app).post('/login').expect(200);
    }
    const res = await request(app).post('/login').expect(429);
    expect(res.body.error).toBe('Demasiados intentos');
    expect(res.body.retryAfter).toBeGreaterThan(0);
  });

  test('el limiter general sigue contando todas las requests', async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 60_000, max: 2 }));
    app.get('/x', (req, res) => res.json({ ok: true }));
    await request(app).get('/x').expect(200);
    await request(app).get('/x').expect(200);
    await request(app).get('/x').expect(429);
  });

  test('_resetStoreForTests limpia todos los limiters', async () => {
    const app = buildApp();
    for (let i = 0; i < 3; i++) await request(app).post('/login');
    await request(app).post('/login').expect(429);
    _resetStoreForTests();
    await request(app).post('/login').expect(200);
  });

  test('keyGenerator: login por IP + email (con CGNAT no se bloquean entre usuarios)', async () => {
    const app = express();
    app.use(express.json());
    const byEmail = createRateLimiter({ windowMs: 60_000, max: 2, keyGenerator: (req) => `${req.ip}|${req.body.email}` });
    app.post('/login', byEmail, (req, res) => res.json({ ok: true }));
    await request(app).post('/login').send({ email: 'a@x.com' }).expect(200);
    await request(app).post('/login').send({ email: 'a@x.com' }).expect(200);
    await request(app).post('/login').send({ email: 'a@x.com' }).expect(429);
    // Otra persona detrás de la misma IP sigue pudiendo entrar
    await request(app).post('/login').send({ email: 'b@x.com' }).expect(200);
  });
});
