const express = require('express');
const router  = express.Router();
const { createReport } = require('../controllers/reportsController');
const authMiddleware   = require('../middleware/auth');
const { createLimiter } = require('../middleware/rateLimiter');

// Auth opcional: si manda token lo identifica, sino acepta anónimo.
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();
  // Si vino token, lo validamos. Si falla, igual seguimos sin user.
  return authMiddleware(req, res, (err) => {
    if (err) req.user = null;
    next();
  });
}

// POST /reports — crear reporte (rate limited, auth opcional)
router.post('/', createLimiter, optionalAuth, createReport);

module.exports = router;
