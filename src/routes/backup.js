const express = require('express');
const router  = express.Router();
const { dumpDatabase } = require('../controllers/backupController');
const { createRateLimiter } = require('../middleware/rateLimiter');

// Rate limit muy bajo: el backup corre 1x/día. 5/hora cubre reintentos del
// cron sin permitir que alguien lo use para scrapear data repetidamente.
const backupLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Demasiados requests de backup.',
});

// GET /backup/dump — protegido por X-Backup-Token header (no JWT)
router.get('/dump', backupLimiter, dumpDatabase);

module.exports = router;
