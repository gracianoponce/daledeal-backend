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

// Reseñas
router.get('/reviews',          listReviews);
router.delete('/reviews/:id',   deleteReview);

// Reportes
router.get('/reports',          listReports);
router.patch('/reports/:id',    updateReport);

module.exports = router;
