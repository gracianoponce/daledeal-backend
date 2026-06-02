const express = require('express');
const router  = express.Router();
const { submitContact } = require('../controllers/contactController');
const { createRateLimiter } = require('../middleware/rateLimiter');

// Sin auth — cualquier visitante puede contactarnos.
// Rate limit estricto para evitar spam: 5 envíos por IP cada 15 min.
const contactLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Demasiados envíos desde tu IP. Esperá unos minutos antes de enviar otro mensaje.',
});

// POST /contact — envía email al equipo + ack al usuario
router.post('/', contactLimiter, submitContact);

module.exports = router;
