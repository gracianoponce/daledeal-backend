const express = require('express');
const router  = express.Router();
const {
  getUserById, getMyProfile, updateProfile, getMyProducts, getMyServices
} = require('../controllers/userController');
const authMiddleware = require('../middleware/auth');

// GET /users/me  (perfil propio completo)
router.get('/me', authMiddleware, getMyProfile);

// GET /users/me/products  (requiere login)
router.get('/me/products', authMiddleware, getMyProducts);

// GET /users/me/services  (requiere login)
router.get('/me/services', authMiddleware, getMyServices);

// PUT /users/me  (requiere login)
router.put('/me', authMiddleware, updateProfile);

// GET /users/:id  (perfil público)
router.get('/:id', getUserById);

module.exports = router;
