/**
 * Middleware de Cache-Control para endpoints GET públicos de lectura.
 *
 * PROBLEMA que resuelve: el backend está en Railway us-east4 (Virginia) y el
 * sitio es para Argentina → ~700ms de RTT por request. Sin cache, CADA
 * navegación entre páginas re-pega al backend en US y el usuario espera.
 *
 * SOLUCIÓN: catálogos (products, services, categories) cambian poco. Con
 * Cache-Control el browser sirve la versión cacheada al instante en
 * navegación repetida, y stale-while-revalidate la actualiza en background.
 *
 * Resultado: la 1ª carga sigue pagando el RTT a US, pero volver a /productos,
 * abrir un producto y volver, etc. → instantáneo desde el cache del browser.
 *
 * NO aplicar a endpoints con datos de usuario o que cambian seguido
 * (orders, users/me, admin, etc.) — esos no llevan cache.
 *
 * @param {number} maxAge          segundos que el browser sirve sin revalidar
 * @param {number} staleRevalidate segundos extra sirviendo cache viejo mientras revalida
 */
function cacheControl(maxAge = 60, staleRevalidate = 300) {
  return (req, res, next) => {
    // Solo cacheamos GET (los POST/PUT/DELETE nunca)
    if (req.method === 'GET') {
      res.set('Cache-Control',
        `public, max-age=${maxAge}, stale-while-revalidate=${staleRevalidate}`);
    }
    next();
  };
}

module.exports = cacheControl;
