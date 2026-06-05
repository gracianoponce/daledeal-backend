const express = require('express');
const router  = express.Router();
const auth         = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const {
  getStats,
  listUsers,
  updateUser,
  listProducts,
  updateProductStatus,
  listOrders,
  listReviews,
  deleteReview,
} = require('../controllers/adminController');
const { listReports, updateReport } = require('../controllers/reportsController');
const { refundOrder } = require('../controllers/paymentsController');
const { listLeads, updateLead } = require('../controllers/contactController');

// Toda la API admin requiere auth + rol admin
router.use(auth);
router.use(requireAdmin);

// Dashboard
router.get('/stats', getStats);

// Usuarios
router.get('/users',         listUsers);
router.patch('/users/:id',   updateUser);

// Productos
router.get('/products',         listProducts);
router.patch('/products/:id',   updateProductStatus);

// Órdenes
router.get('/orders', listOrders);

// Reembolsos — POST /admin/orders/:id/refund
// Body opcional: { amount?: number, reason?: string }
// Sin amount → reembolso total. Con amount < total → parcial.
router.post('/orders/:id/refund', refundOrder);

// Leads B2B (vienen del form de contacto con tipo=empresa)
// GET    /admin/leads         — lista paginada, ?status= para filtrar
// PATCH  /admin/leads/:id     — actualiza status / notes
router.get('/leads',         listLeads);
router.patch('/leads/:id',   updateLead);

// Reseñas
router.get('/reviews',          listReviews);
router.delete('/reviews/:id',   deleteReview);

// Reportes
router.get('/reports',          listReports);
router.patch('/reports/:id',    updateReport);

module.exports = router;
