/**
 * ============================================================
 * DALE DEAL — Rate Limiter (sin dependencias externas)
 * Protege contra fuerza bruta y abuso de la API.
 * ============================================================
 */

/**
 * Cada limiter tiene SU PROPIO almacén en memoria: { ip: { count, resetAt } }.
 * Antes había un único Map compartido por todos: el apiLimiter global sumaba
 * cada request al mismo contador que miraba el authLimiter (máx. 10), así que
 * después de navegar un poco el login respondía 429 "demasiados intentos".
 * En producción se reemplazaría por Redis.
 */
const stores = new Set();

/**
 * Limpia entradas vencidas cada 5 minutos
 */
setInterval(() => {
  const now = Date.now();
  for (const store of stores) {
    for (const [key, record] of store.entries()) {
      if (now >= record.resetAt) store.delete(key);
    }
  }
}, 5 * 60 * 1000).unref?.();

/**
 * Crea un middleware de rate limiting.
 *
 * @param {object} options
 * @param {number} options.windowMs  - Ventana de tiempo en ms (default: 15 min)
 * @param {number} options.max       - Máximo de requests en la ventana (default: 100)
 * @param {string} options.message   - Mensaje de error (default genérico)
 * @param {function} [options.keyGenerator] - req → clave (default: la IP)
 */
function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 100, message, keyGenerator } = {}) {
  const defaultMessage = `Demasiadas solicitudes. Intentá de nuevo en ${Math.round(windowMs / 60000)} minutos.`;
  const store = new Map();
  stores.add(store);

  return function rateLimiterMiddleware(req, res, next) {
    // Identificar por IP (y opcionalmente por usuario si está autenticado)
    const key = keyGenerator ? keyGenerator(req) : (req.ip || req.connection.remoteAddress);
    const now = Date.now();

    let record = store.get(key);

    if (!record || now >= record.resetAt) {
      // Primera solicitud o ventana vencida
      record = { count: 1, resetAt: now + windowMs };
      store.set(key, record);
    } else {
      record.count += 1;
    }

    // Headers estándar de rate limit
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - record.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000));

    if (record.count > max) {
      return res.status(429).json({
        error: message || defaultMessage,
        retryAfter: Math.ceil((record.resetAt - now) / 1000)
      });
    }

    next();
  };
}

// Limiters preconfigurados
module.exports = {
  createRateLimiter,

  // Muy estricto para rutas de autenticación (previene fuerza bruta). Por IP +
  // email: con datos móviles (CGNAT) muchos usuarios comparten la misma IP y,
  // contando solo la IP, se bloqueaban entre ellos.
  authLimiter: createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10,
    message: 'Demasiados intentos de autenticación. Esperá 15 minutos.',
    keyGenerator: (req) => `${req.ip}|${String(req.body?.email || '').trim().toLowerCase()}`,
  }),

  // Tope por IP de todos los intentos de auth juntos (probar muchas cuentas).
  authIpLimiter: createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 60,
    message: 'Demasiados intentos de autenticación. Esperá 15 minutos.'
  }),

  // General para la API. Cada página hace ~8 requests y detrás de un CGNAT
  // varios usuarios comparten IP: con 200 se cortaba navegando normal.
  apiLimiter: createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 1000
  }),

  // Para endpoints de creación (POST)
  createLimiter: createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 30,
    message: 'Límite de publicaciones alcanzado. Intentá en 1 hora.'
  }),

  // ⚠️ Solo para tests — los smoke tests corren todas las requests desde
  // 127.0.0.1, así que sin reset entre describes el limiter se activa y
  // los tests terminan probando "429" en lugar del controller real.
  // No exportar este método en código de producción que NO sea tests.
  _resetStoreForTests() {
    for (const store of stores) store.clear();
  },
};
