const db = require('../config/database');

// ============================================================
// GET /favorites
// Devuelve todos los favoritos del usuario autenticado,
// con datos completos del producto o servicio.
// ============================================================
const getFavorites = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         f.id          AS favorite_id,
         f.item_type,
         f.item_id,
         f.created_at  AS saved_at,
         -- Datos del producto (si aplica)
         p.title       AS product_title,
         p.price       AS product_price,
         p.currency    AS product_currency,
         p.images      AS product_images,
         p.condition   AS product_condition,
         p.status      AS product_status,
         pc.name       AS product_category,
         up.name       AS product_seller,
         -- Datos del servicio (si aplica)
         s.title       AS service_title,
         s.price_from  AS service_price_from,
         s.price_to    AS service_price_to,
         s.currency    AS service_currency,
         s.price_type  AS service_price_type,
         s.images      AS service_images,
         s.status      AS service_status,
         sc.name       AS service_category,
         us.name       AS service_provider
       FROM favorites f
       LEFT JOIN products p         ON f.item_type = 'product' AND f.item_id = p.id
       LEFT JOIN product_categories pc ON p.category_id = pc.id
       LEFT JOIN users up            ON p.seller_id = up.id
       LEFT JOIN services s          ON f.item_type = 'service' AND f.item_id = s.id
       LEFT JOIN service_categories sc ON s.category_id = sc.id
       LEFT JOIN users us             ON s.provider_id = us.id
       WHERE f.user_id = $1
       ORDER BY f.created_at DESC`,
      [req.user.id]
    );

    // Normalizar la respuesta para que cada item tenga una estructura uniforme
    const favorites = result.rows.map(row => {
      const base = {
        favoriteId: row.favorite_id,
        type:       row.item_type,
        itemId:     row.item_id,
        savedAt:    row.saved_at,
      };

      if (row.item_type === 'product') {
        return {
          ...base,
          title:    row.product_title,
          price:    row.product_price,
          currency: row.product_currency,
          images:   row.product_images,
          condition:row.product_condition,
          status:   row.product_status,
          category: row.product_category,
          seller:   row.product_seller,
        };
      } else {
        return {
          ...base,
          title:     row.service_title,
          priceFrom: row.service_price_from,
          priceTo:   row.service_price_to,
          currency:  row.service_currency,
          priceType: row.service_price_type,
          images:    row.service_images,
          status:    row.service_status,
          category:  row.service_category,
          provider:  row.service_provider,
        };
      }
    });

    res.json({ data: favorites, total: favorites.length });
  } catch (err) {
    console.error('Error en getFavorites:', err);
    res.status(500).json({ error: 'Error al obtener favoritos' });
  }
};

// ============================================================
// POST /favorites
// Body: { item_type: 'product'|'service', item_id: number }
// ============================================================
const addFavorite = async (req, res) => {
  const { item_type, item_id } = req.body;

  if (!item_type || !item_id) {
    return res.status(400).json({ error: 'item_type e item_id son obligatorios' });
  }
  if (!['product', 'service'].includes(item_type)) {
    return res.status(400).json({ error: 'item_type debe ser "product" o "service"' });
  }

  try {
    // Verificar que el item existe
    const table  = item_type === 'product' ? 'products' : 'services';
    const exists = await db.query(`SELECT id FROM ${table} WHERE id = $1`, [item_id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: `${item_type === 'product' ? 'Producto' : 'Servicio'} no encontrado` });
    }

    // Evitar duplicados
    const dup = await db.query(
      'SELECT id FROM favorites WHERE user_id = $1 AND item_type = $2 AND item_id = $3',
      [req.user.id, item_type, item_id]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'Ya está en tus favoritos', favoriteId: dup.rows[0].id });
    }

    const result = await db.query(
      `INSERT INTO favorites (user_id, item_type, item_id)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, item_type, item_id, created_at`,
      [req.user.id, item_type, item_id]
    );

    res.status(201).json({
      message:    'Agregado a favoritos',
      favorite:   result.rows[0],
    });
  } catch (err) {
    console.error('Error en addFavorite:', err);
    res.status(500).json({ error: 'Error al agregar a favoritos' });
  }
};

// ============================================================
// DELETE /favorites/:id
// Elimina un favorito por su ID (solo el dueño puede hacerlo)
// ============================================================
const removeFavorite = async (req, res) => {
  const { id } = req.params;

  try {
    const check = await db.query(
      'SELECT user_id FROM favorites WHERE id = $1',
      [id]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Favorito no encontrado' });
    }
    if (check.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'No tenés permiso' });
    }

    await db.query('DELETE FROM favorites WHERE id = $1', [id]);
    res.json({ message: 'Eliminado de favoritos' });
  } catch (err) {
    console.error('Error en removeFavorite:', err);
    res.status(500).json({ error: 'Error al eliminar favorito' });
  }
};

// ============================================================
// DELETE /favorites/item/:type/:id
// Elimina por tipo+itemId (más cómodo desde el frontend)
// ============================================================
const removeFavoriteByItem = async (req, res) => {
  const { type, itemId } = req.params;

  if (!['product', 'service'].includes(type)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }

  try {
    const result = await db.query(
      'DELETE FROM favorites WHERE user_id = $1 AND item_type = $2 AND item_id = $3 RETURNING id',
      [req.user.id, type, itemId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No encontrado en tus favoritos' });
    }

    res.json({ message: 'Eliminado de favoritos' });
  } catch (err) {
    console.error('Error en removeFavoriteByItem:', err);
    res.status(500).json({ error: 'Error al eliminar favorito' });
  }
};

// ============================================================
// GET /favorites/check/:type/:itemId
// Verifica si un item está en los favoritos del usuario
// ============================================================
const checkFavorite = async (req, res) => {
  const { type, itemId } = req.params;

  try {
    const result = await db.query(
      'SELECT id FROM favorites WHERE user_id = $1 AND item_type = $2 AND item_id = $3',
      [req.user.id, type, itemId]
    );

    res.json({
      isFavorite:  result.rows.length > 0,
      favoriteId:  result.rows[0]?.id || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al verificar favorito' });
  }
};

module.exports = { getFavorites, addFavorite, removeFavorite, removeFavoriteByItem, checkFavorite };
