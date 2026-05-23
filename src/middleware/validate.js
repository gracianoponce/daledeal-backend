/**
 * ============================================================
 * DALE DEAL — Validaciones de Input
 * ============================================================
 */

const EMAIL_REGEX   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX   = /^[\d\s\+\-\(\)]{6,20}$/;
const URL_REGEX     = /^https?:\/\/.+/i;
const SAFE_URL_REGEX = /^https?:\/\/[^\s<>"']+$/i;

/**
 * Sanitiza un string: escapa HTML, trim, normaliza espacios.
 *
 * Escapamos los 5 caracteres especiales de HTML (no solo < y >) para evitar
 * XSS por inyección en ATRIBUTOS. Ejemplo: si el frontend hace
 *   <img alt="${product.title}">
 * y un vendedor pone su título como  iPhone" onerror="alert(1)
 * sin escapar las " se rompe el atributo y se ejecuta el handler. Escapar
 * &, ', " junto con <, > cierra todos los vectores XSS comunes.
 */
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str
    .trim()
    .replace(/&/g, '&amp;')   // primero & para no doble-escapar
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\s+/g, ' ');
}

/**
 * Valida fuerza de contraseña.
 * Retorna { ok, message }
 */
function validatePassword(password) {
  if (!password || password.length < 8) {
    return { ok: false, message: 'La contraseña debe tener al menos 8 caracteres' };
  }
  if (!/[A-Z]/.test(password)) {
    return { ok: false, message: 'La contraseña debe tener al menos una letra mayúscula' };
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, message: 'La contraseña debe tener al menos un número' };
  }
  return { ok: true };
}

/**
 * Valida formato de email.
 */
function validateEmail(email) {
  if (!email || !EMAIL_REGEX.test(email)) {
    return { ok: false, message: 'Email inválido' };
  }
  return { ok: true };
}

/**
 * Valida que una URL sea http(s) y NO use schemes peligrosos
 * (javascript:, data:, file:, vbscript:). Importante para campos
 * que terminan en `<img src>` o `<a href>` del frontend.
 */
function validateSafeUrl(url) {
  if (!url) return { ok: true }; // opcional → ok
  const s = String(url).trim();
  // Rechazar explícitamente schemes peligrosos antes del regex
  if (/^\s*(javascript|data|vbscript|file):/i.test(s)) {
    return { ok: false, message: 'URL inválida' };
  }
  if (!SAFE_URL_REGEX.test(s) || s.length > 500) {
    return { ok: false, message: 'URL inválida' };
  }
  return { ok: true };
}

/**
 * Middleware: sanitiza req.body automáticamente (strings).
 */
function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    for (const key of Object.keys(req.body)) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitize(req.body[key]);
      }
    }
  }
  next();
}

/**
 * Valida paginación de query params.
 * Normaliza page y limit a enteros seguros.
 */
function parsePagination(query) {
  let page  = parseInt(query.page)  || 1;
  let limit = parseInt(query.limit) || 20;
  page  = Math.max(1, page);
  limit = Math.min(100, Math.max(1, limit));
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Valida sort order.
 */
function parseSortOrder(query, allowedFields = ['created_at', 'price', 'title', 'views']) {
  const field = allowedFields.includes(query.sort) ? query.sort : 'created_at';
  const order = query.order === 'asc' ? 'ASC' : 'DESC';
  return { field, order };
}

module.exports = {
  sanitize,
  sanitizeBody,
  validatePassword,
  validateEmail,
  validateSafeUrl,
  parsePagination,
  parseSortOrder,
  EMAIL_REGEX,
  PHONE_REGEX,
  URL_REGEX,
  SAFE_URL_REGEX,
};
