const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const {
  requestVerification, getMyVerification, uploadDocuments,
} = require('../controllers/verificationController');

// POST /verifications      → el prestador solicita una verificación (auth)
router.post('/', authMiddleware, requestVerification);
// POST /verifications/documents → DNI frente/dorso + cara (+ título) en base64.
// Límite propio: el global de index.js es 2 MB y acá viajan hasta 4 archivos.
router.post('/documents', authMiddleware, express.json({ limit: '12mb' }), uploadDocuments);
// GET  /verifications/me   → estado propio + historial (auth)
router.get('/me', authMiddleware, getMyVerification);

module.exports = router;
