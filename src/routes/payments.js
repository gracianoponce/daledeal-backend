/**
 * ============================================================
 * DALE DEAL — Rutas de Pagos (Mercado Pago)
 * ============================================================
 *
 * POST   /payments/preference        → crea preferencia de MP y devuelve init_point
 *                                      (requiere auth — solo el comprador puede iniciar)
 *
 * POST   /payments/webhook           → notificación IPN de Mercado Pago
 *                                      (NO requiere auth — se valida firma x-signature)
 *
 * GET    /payments/:orderId/status   → estado actual del pago
 *                                      (requiere auth — solo buyer o seller de la orden)
 * ============================================================
 */

const express = require('express');
const router  = express.Router();

const {
  createPreference,
  handleWebhook,
  getStatus,
} = require('../controllers/paymentsController');

const authMiddleware          = require('../middleware/auth');
const { createRateLimiter }   = require('../middleware/rateLimiter');

// ------------------------------------------------------------
// Rate limiter específico para crear preferencias.
// 10 requests por minuto por IP — evita que alguien spamee la
// API de MP y nos baneen la key.
// ------------------------------------------------------------
const preferenceLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Demasiados intentos de pago. Esperá un minuto e intentá de nuevo.',
});

// ------------------------------------------------------------
// 1) Webhook — PRIMERO, antes del authMiddleware global.
//    MP llega sin token, y debe responder 200 lo antes posible.
// ------------------------------------------------------------
router.post('/webhook', handleWebhook);

// ------------------------------------------------------------
// 2) Endpoints que requieren auth (el usuario logueado)
// ------------------------------------------------------------
router.post('/preference', authMiddleware, preferenceLimiter, createPreference);
router.get('/:orderId/status', authMiddleware, getStatus);

module.exports = router;
