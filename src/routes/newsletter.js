const express = require('express');
const router  = express.Router();
const { subscribe } = require('../controllers/newsletterController');
const { createRateLimiter } = require('../middleware/rateLimiter');

// Rate-limit fuerte: 10 suscripciones por IP cada 15 min. Suficiente para
// humanos legítimos, frena bots que intentan llenar la tabla.
const newsletterLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Demasiadas suscripciones desde tu IP. Probá más tarde.',
});

// POST /newsletter/subscribe — público
router.post('/subscribe', newsletterLimiter, subscribe);

module.exports = router;
