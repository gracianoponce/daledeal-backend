/**
 * ============================================================
 * DALE DEAL — Rate Limiter (sin dependencias externas)
 * Protege contra fuerza bruta y abuso de la API.
 * ============================================================
 */

/**
 * Almacén en memoria: { ip: { count, resetAt } }
 * En producción se reemplazaría por Redis.
 */
const store = new Map();

/**
 * Limpia entradas vencidas cada 5 minutos
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of store.entries()) {
    if (now >= record.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000);

/**
 * Crea un middleware de rate limiting.
 *
 * @param {object} options
 * @param {number} options.windowMs  - Ventana de tiempo en ms (default: 15 min)
 * @param {number} options.max       - Máximo de requests en la ventana (default: 100)
 * @param {string} options.message   - Mensaje de error (default genérico)
 */
function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 100, message } = {}) {
  const defaultMessage = `Demasiadas solicitudes. Intentá de nuevo en ${Math.round(windowMs / 60000)} minutos.`;

  return function rateLimiterMiddleware(req, res, next) {
    // Identificar por IP (y opcionalmente por usuario si está autenticado)
    const key = req.ip || req.connection.remoteAddress;
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

  // Muy estricto para rutas de autenticación (previene fuerza bruta)
  authLimiter: createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10,
    message: 'Demasiados intentos de autenticación. Esperá 15 minutos.'
  }),

  // General para la API
  apiLimiter: createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 200
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
    store.clear();
  },
};
