require('dotenv').config();
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
// En dev aceptamos cualquier origen incluyendo file:// (que manda null como origin)
app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (Postman, curl) y file:// (origin = null)
    if (!origin || process.env.NODE_ENV === 'development') return callback(null, true);
    const allowed = (process.env.FRONTEND_URL || '').split(',').map(u => u.trim());
    if (allowed.includes('*') || allowed.includes(origin)) return callback(null, true);
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
app.use('/api', apiLimiter);

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

// ============================================================
// FRONTEND ESTÁTICO
// Sirve dale-deal-front desde /frontend para poder abrir
// http://localhost:3000/frontend/index.html sin problemas de CORS
// ============================================================
const frontendPath = path.join(__dirname, '../../..', 'dale-deal-front');
app.use('/frontend', express.static(frontendPath));

// Ruta raíz — health check
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
    }
  });
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

// Error genérico
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
app.listen(PORT, () => {
  console.log(`🚀 Servidor Dale Deal v2.0 corriendo en http://localhost:${PORT}`);
  console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔒 Rate limiting, security headers y logging activos`);
});
