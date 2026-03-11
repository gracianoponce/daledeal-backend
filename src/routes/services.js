const express = require('express');
const router  = express.Router();
const {
  getServices, getServiceById, createService,
  updateService, deleteService, getCategories
} = require('../controllers/serviceController');
const authMiddleware = require('../middleware/auth');

// GET /services/categories
router.get('/categories', getCategories);

// GET /services
router.get('/', getServices);

// GET /services/:id
router.get('/:id', getServiceById);

// POST /services  (requiere login)
router.post('/', authMiddleware, createService);

// PUT /services/:id  (requiere login)
router.put('/:id', authMiddleware, updateService);

// DELETE /services/:id  (requiere login)
router.delete('/:id', authMiddleware, deleteService);

module.exports = router;
