const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const { createReport } = require('../controllers/reportsController');
const { createLimiter } = require('../middleware/rateLimiter');

// Auth opcional: si manda token válido lo identifica; si no hay token
// o es inválido, sigue como anónimo (no usa authMiddleware porque ese
// responde 401 directamente ante un token inválido).
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();
  try {
    req.user = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
  } catch (err) {
    req.user = null;
  }
  next();
}

// POST /reports — crear reporte (rate limited, auth opcional)
router.post('/', createLimiter, optionalAuth, createReport);

module.exports = router;
