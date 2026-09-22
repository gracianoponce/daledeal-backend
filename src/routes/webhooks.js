const express = require('express');
const router  = express.Router();
const { ship24Webhook } = require('../controllers/trackingController');

/**
 * Webhooks entrantes de proveedores (sin JWT: cada uno valida su secreto).
 * El de Mercado Pago vive en /payments/webhook por historia.
 *
 * POST /webhooks/ship24 — cambios de estado de envíos (Authorization: Bearer <secret>)
 * GET  /webhooks/ship24 — ping para comprobar a mano que la URL existe
 */
router.post('/ship24', ship24Webhook);
router.get('/ship24', (req, res) => res.json({ ok: true }));

module.exports = router;
