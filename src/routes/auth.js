const express = require('express');
const router  = express.Router();
const { register, login, me } = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');

// POST /auth/register
router.post('/register', register);

// POST /auth/login
router.post('/login', login);

// GET /auth/me  (requiere token)
router.get('/me', authMiddleware, me);

module.exports = router;
