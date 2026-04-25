/**
 * ============================================================
 * DALE DEAL — Validaciones de Input
 * ============================================================
 */

const EMAIL_REGEX   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX   = /^[\d\s\+\-\(\)]{6,20}$/;
const URL_REGEX     = /^https?:\/\/.+/;

/**
 * Sanitiza un string: elimina HTML/scripts, trim, normaliza espacios.
 */
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str
    .trim()
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
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
  validateEmail,
  parsePagination,
  parseSortOrder,
  EMAIL_REGEX,
  PHONE_REGEX,
  URL_REGEX,
};
