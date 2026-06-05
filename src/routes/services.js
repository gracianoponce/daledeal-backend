const express = require('express');
const router  = express.Router();
const {
  getServices, getServiceById, createService,
  updateService, deleteService, getCategories
} = require('../controllers/serviceController');
const authMiddleware = require('../middleware/auth');
const cacheControl   = require('../middleware/cacheControl');

const catalogCache  = cacheControl(60, 300);
const categoryCache = cacheControl(600, 3600);

// GET /services/categories
router.get('/categories', categoryCache, getCategories);

// GET /services
router.get('/', catalogCache, getServices);

// GET /services/:id
router.get('/:id', catalogCache, getServiceById);

// POST /services  (requiere login)
router.post('/', authMiddleware, createService);

// PUT /services/:id  (requiere login)
router.put('/:id', authMiddleware, updateService);

// DELETE /services/:id  (requiere login)
router.delete('/:id', authMiddleware, deleteService);

module.exports = router;
