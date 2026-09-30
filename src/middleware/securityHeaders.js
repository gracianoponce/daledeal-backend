/**
 * ============================================================
 * DALE DEAL — Security Headers (equivalente a Helmet, sin deps)
 * ============================================================
 */

module.exports = function securityHeaders(req, res, next) {
  // Previene clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // HSTS: el navegador usa siempre HTTPS con la API (lo ignora sobre http).
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  // Previene MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Content Security Policy básica
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'none'; object-src 'none';"
  );

  // XSS Protection (para navegadores legacy)
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // No exponer información del servidor
  res.removeHeader('X-Powered-By');

  // Permissions Policy (deshabilitar features innecesarias)
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=()'
  );

  next();
};
