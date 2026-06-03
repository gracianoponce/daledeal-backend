require('dotenv').config();

// Sentry MUST be the first import after dotenv — su SDK v8 monkeypatcha
// http/express y necesita engancharse antes de que cualquier handler se
// registre. Si SENTRY_DSN_BACKEND no está seteado, init() es no-op.
const { initSentry, Sentry } = require('./config/sentry');
const sentryEnabled = initSentry();

// Validar env vars críticas antes de cualquier otra cosa.
// Si falta algo crítico, este process.exit(1) y nadie pierde tiempo.
require('./config/validateEnv')();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

// Middlewares custom
const securityHeaders = require('./middleware/securityHeaders');
const logger          = require('./middleware/logger');
const { sanitizeBody } = require('./middleware/validate');
const { apiLimiter }   = require('./middleware/rateLimiter');

// Importar rutas
const authRoutes      = require('./routes/auth');
const productRoutes   = require('./routes/products');
const serviceRoutes   = require('./routes/services');
const userRoutes      = require('./routes/users');
const favoritesRoutes = require('./routes/favorites');
const ordersRoutes    = require('./routes/orders');
const reviewsRoutes   = require('./routes/reviews');
const messagesRoutes  = require('./routes/messages');
const paymentsRoutes  = require('./routes/payments');
const adminRoutes     = require('./routes/admin');
const reportsRoutes   = require('./routes/reports');
const contactRoutes   = require('./routes/contact');
const sitemapRoutes   = require('./routes/sitemap');

const app  = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARES GLOBALES
// ============================================================

// 1. Security headers (primero de todo)
app.use(securityHeaders);

// 2. Logger de requests
app.use(logger);

// 3. CORS
// Solo abrimos completamente si NODE_ENV es EXPLÍCITAMENTE 'development'.
// Si NODE_ENV está vacío, mal seteado o = 'production' → aplicamos whitelist.
const IS_DEV = process.env.NODE_ENV === 'development';
const normalizeOrigin = u => String(u || '').trim().toLowerCase().replace(/\/+$/, '');
app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (Postman, curl, mismo-origin) y file:// (origin = null)
    if (!origin) return callback(null, true);
    if (IS_DEV)  return callback(null, true);
    const allowed = (process.env.FRONTEND_URL || '')
      .split(',').map(normalizeOrigin).filter(Boolean);
    const o = normalizeOrigin(origin);
    if (allowed.includes('*') || allowed.includes(o)) return callback(null, true);
    callback(new Error(`CORS: origen no permitido — ${origin}`));
  },
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials:    true,
}));

// 4. Body parsers
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// 5. Sanitización de inputs
app.use(sanitizeBody);

// 6. Rate limiting global
// Las rutas reales NO tienen prefijo /api (montamos /auth, /products, etc.),
// así que aplicamos el limiter a todo. Los limiters más estrictos
// (authLimiter, etc.) se siguen montando dentro de cada ruta.
app.use(apiLimiter);

// ============================================================
// RUTAS
// ============================================================
app.use('/auth',      authRoutes);
app.use('/products',  productRoutes);
app.use('/services',  serviceRoutes);
app.use('/users',     userRoutes);
app.use('/favorites', favoritesRoutes);
app.use('/orders',    ordersRoutes);
app.use('/reviews',   reviewsRoutes);
app.use('/messages',  messagesRoutes);
app.use('/payments',  paymentsRoutes);
app.use('/admin',     adminRoutes);
app.use('/reports',   reportsRoutes);
app.use('/contact',   contactRoutes);
// Sitemaps dinámicos (sin prefijo, mounted en root para /sitemap-*.xml)
app.use('/',          sitemapRoutes);

// ============================================================
// FRONTEND ESTÁTICO
// Sirve dale-deal-front desde /frontend para poder abrir
// http://localhost:3000/frontend/index.html sin problemas de CORS
// ============================================================
const frontendPath = path.join(__dirname, '../../..', 'dale-deal-front');
app.use('/frontend', express.static(frontendPath));

// Ruta raíz — info de la API
app.get('/', (req, res) => {
  res.json({
    message: '🟢 Dale Deal API funcionando',
    version: '2.0.0',
    env:      process.env.NODE_ENV || 'development',
    endpoints: {
      auth:      '/auth',
      products:  '/products',
      services:  '/services',
      users:     '/users',
      favorites: '/favorites',
      orders:    '/orders',
      reviews:   '/reviews',
      messages:  '/messages',
      payments:  '/payments',
      health:    '/health',
    }
  });
});

// Health check dedicado para load balancers / uptime monitors.
// Hace una query trivial a la DB para asegurar conectividad.
// En prod devolvemos lo mínimo (no exponer env/version es buena higiene).
app.get('/health', async (req, res) => {
  const start = Date.now();
  const isProd = process.env.NODE_ENV === 'production';
  try {
    const db = require('./config/database');
    await db.query('SELECT 1');
    if (isProd) return res.json({ status: 'ok' });
    res.json({
      status:    'ok',
      uptime_s:  Math.round(process.uptime()),
      latency_ms: Date.now() - start,
      env:       process.env.NODE_ENV || 'development',
      version:   '2.0.0',
    });
  } catch (err) {
    res.status(503).json({ status: 'error' });
  }
});

// ============================================================
// MANEJO DE ERRORES GLOBAL
// ============================================================

// 404
app.use((req, res) => {
  res.status(404).json({
    error:   'Ruta no encontrada',
    path:    req.originalUrl,
    method:  req.method,
  });
});

// Sentry expressErrorHandler: captura cualquier error 5xx ANTES del handler
// genérico de abajo. Solo registra errores con statusCode >= 500 por default,
// no spamea con 4xx (que son errores de cliente, no del servidor).
// Si sentry no está inicializado (sin DSN), Sentry.setupExpressErrorHandler
// hace nothing — seguro de llamar.
if (sentryEnabled) {
  Sentry.setupExpressErrorHandler(app);
}

// Error genérico (corre DESPUÉS del handler de Sentry)
app.use((err, req, res, next) => {
  const status  = err.status || err.statusCode || 500;
  const isDev   = process.env.NODE_ENV !== 'production';

  console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err.message);
  if (isDev) console.error(err.stack);

  res.status(status).json({
    error:   status === 500 ? 'Error interno del servidor' : err.message,
    ...(isDev && { stack: err.stack }),
  });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
// El listen solo corre si este archivo se ejecuta directo (npm start).
// Cuando los tests con supertest hacen require('./index'), reciben el app
// configurado pero sin abrir el puerto (cada test maneja su propia instancia).
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor Dale Deal v2.0 corriendo en http://localhost:${PORT}`);
    console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔒 Rate limiting, security headers y logging activos`);
  });
}

module.exports = app;
