const express = require('express');
const router  = express.Router();
const {
  getProducts, getProductById, createProduct,
  updateProduct, deleteProduct, getCategories
} = require('../controllers/productController');
const authMiddleware = require('../middleware/auth');

// GET /products/categories
router.get('/categories', getCategories);

// GET /products
router.get('/', getProducts);

// GET /products/:id
router.get('/:id', getProductById);

// POST /products  (requiere login)
router.post('/', authMiddleware, createProduct);

// PUT /products/:id  (requiere login)
router.put('/:id', authMiddleware, updateProduct);

// DELETE /products/:id  (requiere login)
router.delete('/:id', authMiddleware, deleteProduct);

module.exports = router;
