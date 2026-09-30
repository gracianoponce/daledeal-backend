const express = require('express');
const router  = express.Router();
const {
  getReviews,
  createReview,
  updateReview,
  deleteReview,
  getUserReviews,
} = require('../controllers/reviewsController');
const authMiddleware = require('../middleware/auth');

// GET  /reviews/user/:userId      — Reseñas recibidas por un usuario (público)
// Tiene que ir ANTES de /:type/:itemId: si no, "user" se tomaba como :type y
// esta ruta nunca respondía.
router.get('/user/:userId', getUserReviews);

// GET  /reviews/:type/:itemId     — Reseñas de un producto o servicio (público)
router.get('/:type/:itemId', getReviews);

// --- Rutas protegidas ---

// POST /reviews                   — Crear reseña
router.post('/', authMiddleware, createReview);

// PUT  /reviews/:id               — Editar reseña propia
router.put('/:id', authMiddleware, updateReview);

// DELETE /reviews/:id             — Eliminar reseña propia
router.delete('/:id', authMiddleware, deleteReview);

module.exports = router;
