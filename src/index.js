require('dotenv').config();
const express = require('express');
const cors    = require('cors');

// Importar rutas
const authRoutes     = require('./routes/auth');
const productRoutes  = require('./routes/products');
const serviceRoutes  = require('./routes/services');
const userRoutes     = require('./routes/users');

const app  = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARES GLOBALES
// ============================================================
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// RUTAS
// ============================================================
app.use('/auth',     authRoutes);
app.use('/products', productRoutes);
app.use('/services', serviceRoutes);
app.use('/users',    userRoutes);

// Ruta raíz - health check
app.get('/', (req, res) => {
  res.json({
    message: '🟢 Dale Deal API funcionando',
    version: '1.0.0',
    endpoints: {
      auth:     '/auth',
      products: '/products',
      services: '/services',
      users:    '/users'
    }
  });
});

// ============================================================
// MANEJO GLOBAL DE ERRORES
// ============================================================
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 Servidor Dale Deal corriendo en http://localhost:${PORT}`);
  console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
});
