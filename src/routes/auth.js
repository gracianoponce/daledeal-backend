const express = require('express');
const router  = express.Router();
const {
  register, login, googleAuth, me, changePassword, deactivateAccount,
  forgotPassword, resetPassword,
} = require('../controllers/authController');
const authMiddleware     = require('../middleware/auth');
const { authLimiter, authIpLimiter } = require('../middleware/rateLimiter');

// POST /auth/register  (rate limited)
router.post('/register', authIpLimiter, authLimiter, register);

// POST /auth/login     (rate limited)
router.post('/login', authIpLimiter, authLimiter, login);

// POST /auth/google    (rate limited) — verifica ID token de Google y devuelve JWT
router.post('/google', authIpLimiter, authLimiter, googleAuth);

// GET  /auth/me        (requiere token)
router.get('/me', authMiddleware, me);

// POST /auth/change-password (requiere token, ya logueado)
router.post('/change-password', authMiddleware, changePassword);

// POST /auth/deactivate (requiere token)
router.post('/deactivate', authMiddleware, deactivateAccount);

// POST /auth/forgot-password — solicitar link de reset (rate limited)
router.post('/forgot-password', authIpLimiter, authLimiter, forgotPassword);

// POST /auth/reset-password — cambiar contraseña con token (rate limited)
router.post('/reset-password', authIpLimiter, authLimiter, resetPassword);

module.exports = router;
