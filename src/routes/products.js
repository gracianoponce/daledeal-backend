const express = require('express');
const router  = express.Router();
const {
  getProducts, getProductById, createProduct,
  updateProduct, deleteProduct, getCategories
} = require('../controllers/productController');
const authMiddleware = require('../middleware/auth');
const cacheControl   = require('../middleware/cacheControl');

// Cache para GET de catálogo: 60s fresh + 5min stale-while-revalidate.
// Mitiga la latencia del backend en US para usuarios argentinos.
// Las categorías cambian aún menos → cache más largo (10min).
const catalogCache  = cacheControl(60, 300);
const categoryCache = cacheControl(600, 3600);

// GET /products/categories
router.get('/categories', categoryCache, getCategories);

// GET /products
router.get('/', catalogCache, getProducts);

// GET /products/:id
router.get('/:id', catalogCache, getProductById);

// POST /products  (requiere login)
router.post('/', authMiddleware, createProduct);

// PUT /products/:id  (requiere login)
router.put('/:id', authMiddleware, updateProduct);

// DELETE /products/:id  (requiere login)
router.delete('/:id', authMiddleware, deleteProduct);

module.exports = router;
