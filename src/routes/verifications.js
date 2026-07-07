const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const {
  requestVerification, getMyVerification,
} = require('../controllers/verificationController');

// POST /verifications      → el prestador solicita una verificación (auth)
router.post('/', authMiddleware, requestVerification);
// GET  /verifications/me   → estado propio + historial (auth)
router.get('/me', authMiddleware, getMyVerification);

module.exports = router;
