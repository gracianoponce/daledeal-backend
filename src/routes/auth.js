const express = require('express');
const router  = express.Router();
const {
  register, login, me, changePassword, deactivateAccount,
  forgotPassword, resetPassword,
} = require('../controllers/authController');
const authMiddleware     = require('../middleware/auth');
const { authLimiter }    = require('../middleware/rateLimiter');

// POST /auth/register  (rate limited)
router.post('/register', authLimiter, register);

// POST /auth/login     (rate limited)
router.post('/login', authLimiter, login);

// GET  /auth/me        (requiere token)
router.get('/me', authMiddleware, me);

// POST /auth/change-password (requiere token, ya logueado)
router.post('/change-password', authMiddleware, changePassword);

// POST /auth/deactivate (requiere token)
router.post('/deactivate', authMiddleware, deactivateAccount);

// POST /auth/forgot-password — solicitar link de reset (rate limited)
router.post('/forgot-password', authLimiter, forgotPassword);

// POST /auth/reset-password — cambiar contraseña con token (rate limited)
router.post('/reset-password', authLimiter, resetPassword);

module.exports = router;
