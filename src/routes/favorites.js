const express = require('express');
const router  = express.Router();
const {
  getFavorites,
  addFavorite,
  removeFavorite,
  removeFavoriteByItem,
  checkFavorite,
} = require('../controllers/favoritesController');
const authMiddleware = require('../middleware/auth');

// Todas las rutas de favoritos requieren autenticación
router.use(authMiddleware);

// GET    /favorites               — Lista mis favoritos
router.get('/', getFavorites);

// GET    /favorites/check/:type/:itemId — ¿Está en mis favoritos?
router.get('/check/:type/:itemId', checkFavorite);

// POST   /favorites               — Agregar a favoritos
router.post('/', addFavorite);

// DELETE /favorites/:id           — Eliminar por ID de favorito
router.delete('/:id', removeFavorite);

// DELETE /favorites/item/:type/:itemId — Eliminar por tipo+itemId
router.delete('/item/:type/:itemId', removeFavoriteByItem);

module.exports = router;
