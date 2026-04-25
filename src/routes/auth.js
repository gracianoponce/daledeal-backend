const express = require('express');
const router  = express.Router();
const { register, login, me, changePassword, deactivateAccount } = require('../controllers/authController');
const authMiddleware     = require('../middleware/auth');
const { authLimiter }    = require('../middleware/rateLimiter');

// POST /auth/register  (rate limited)
router.post('/register', authLimiter, register);

// POST /auth/login     (rate limited)
router.post('/login', authLimiter, login);

// GET  /auth/me        (requiere token)
router.get('/me', authMiddleware, me);

// POST /auth/change-password (requiere token)
router.post('/change-password', authMiddleware, changePassword);

// POST /auth/deactivate (requiere token)
router.post('/deactivate', authMiddleware, deactivateAccount);

module.exports = router;
