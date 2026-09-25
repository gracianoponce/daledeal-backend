const express = require('express');
const router  = express.Router();
const {
  getUserById, getMyProfile, updateProfile, getMyProducts, getMyServices
} = require('../controllers/userController');
const { getMyPayoutAccount, updateMyPayoutAccount } = require('../controllers/payoutAccountController');
const authMiddleware = require('../middleware/auth');

// GET /users/me  (perfil propio completo)
router.get('/me', authMiddleware, getMyProfile);

// GET /users/me/products  (requiere login)
router.get('/me/products', authMiddleware, getMyProducts);

// GET /users/me/services  (requiere login)
router.get('/me/services', authMiddleware, getMyServices);

// PUT /users/me  (requiere login)
router.put('/me', authMiddleware, updateProfile);

// Datos de cobro (alias / CVU / CBU) — solo el dueño
router.get('/me/payout-account', authMiddleware, getMyPayoutAccount);
router.put('/me/payout-account', authMiddleware, updateMyPayoutAccount);

// GET /users/:id  (perfil público)
router.get('/:id', getUserById);

module.exports = router;
