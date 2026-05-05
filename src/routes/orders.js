const express = require('express');
const router  = express.Router();
const {
  createOrder,
  getMyOrders,
  getMySales,
  getOrderById,
  updateOrderStatus,
  updateShippingTracking,
} = require('../controllers/ordersController');
const authMiddleware            = require('../middleware/auth');
const { createLimiter }         = require('../middleware/rateLimiter');

// Todas las rutas de órdenes requieren autenticación
router.use(authMiddleware);

// POST   /orders             — Crear una orden (rate limited)
router.post('/', createLimiter, createOrder);

// GET    /orders/my          — Mis compras
router.get('/my', getMyOrders);

// GET    /orders/sales       — Mis ventas
router.get('/sales', getMySales);

// GET    /orders/:id         — Detalle de una orden
router.get('/:id', getOrderById);

// PATCH  /orders/:id/status    — Actualizar estado de una orden
router.patch('/:id/status', updateOrderStatus);

// PATCH  /orders/:id/shipping  — Vendedor: cargar tracking + marcar despachado
router.patch('/:id/shipping', updateShippingTracking);

module.exports = router;
