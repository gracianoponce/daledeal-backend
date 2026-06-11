/**
 * Tests del endpoint POST /contact.
 *
 * No requieren DB poblada: el controller es retrocompatible — si la tabla
 * contact_messages no existe (o la DB está caída), la persistencia se saltea
 * sin romper la request, y el envío de email cae a modo dev (console.log) si
 * no hay RESEND_API_KEY. Por eso un contacto válido siempre responde 200.
 */
const request = require('supertest');
const app     = require('../src/index');
const { _resetStoreForTests } = require('../src/middleware/rateLimiter');

beforeEach(() => {
  _resetStoreForTests();
});

describe('POST /contact', () => {
  test('acepta un mensaje válido y responde ok:true', async () => {
    const res = await request(app).post('/contact').send({
      nombre:   'Juan',
      apellido: 'Pérez',
      email:    'juan.perez@example.com',
      asunto:   'Consulta general',
      mensaje:  'Hola, quería hacer una consulta sobre un producto. Gracias.',
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
  });

  test('rechaza con 400 si faltan campos obligatorios', async () => {
    const res = await request(app).post('/contact').send({ nombre: 'Juan' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('rechaza con 400 si el email es inválido', async () => {
    const res = await request(app).post('/contact').send({
      nombre: 'Juan', apellido: 'Pérez', email: 'no-es-un-email',
      asunto: 'Test', mensaje: 'Mensaje suficientemente largo para pasar.',
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('honeypot: si viene "website", responde 200 sin procesar (anti-bot)', async () => {
    const res = await request(app).post('/contact').send({
      nombre: 'Bot', apellido: 'Spam', email: 'bot@spam.com',
      asunto: 'spam', mensaje: 'comprá seguidores baratos ahora',
      website: 'http://spam-link.com',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
