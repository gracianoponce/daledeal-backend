const express = require('express');
const router  = express.Router();
const {
  startConversation,
  listConversations,
  getMessages,
  sendMessage,
  markAsRead,
  getUnreadCount,
} = require('../controllers/messageController');
const authMiddleware  = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimiter');

// Todas las rutas requieren autenticación
router.use(authMiddleware);

// Rate limiter específico para envío de mensajes (60 por minuto por IP)
const messageLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Estás enviando mensajes demasiado rápido. Esperá un momento.',
});

// ============================================================
// Conversaciones
// ============================================================
// POST /messages/conversations           — iniciar / recuperar conversación
router.post('/conversations', startConversation);

// GET  /messages/conversations           — mis conversaciones
router.get('/conversations', listConversations);

// GET  /messages/conversations/:id/messages — mensajes de la conversación
router.get('/conversations/:id/messages', getMessages);

// POST /messages/conversations/:id/messages — enviar mensaje
router.post('/conversations/:id/messages', messageLimiter, sendMessage);

// POST /messages/conversations/:id/read — marcar como leídos
router.post('/conversations/:id/read', markAsRead);

// ============================================================
// Global
// ============================================================
// GET /messages/unread-count — total no leídos (para badge global)
router.get('/unread-count', getUnreadCount);

module.exports = router;
