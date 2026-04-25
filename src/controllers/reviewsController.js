const db = require('../config/database');

// ============================================================
// GET /reviews/:type/:itemId
// type: 'product' | 'service'
// Devuelve las reseñas de un producto o servicio, con paginación.
// ============================================================
const getReviews = async (req, res) => {
  const { type, itemId } = req.params;
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 10);
  const offset = (page - 1) * limit;

  if (!['product', 'service'].includes(type)) {
    return res.status(400).json({ error: 'Tipo inválido. Usar "product" o "service"' });
  }

  try {
    const result = await db.query(
      `SELECT
         r.id, r.rating, r.title, r.body, r.created_at,
         u.id   AS reviewer_id,
         u.name AS reviewer_name,
         u.avatar_url AS reviewer_avatar
       FROM reviews r
       LEFT JOIN users u ON r.reviewer_id = u.id
       WHERE r.item_type = $1 AND r.item_id = $2
       ORDER BY r.created_at DESC
       LIMIT $3 OFFSET $4`,
      [type, itemId, limit, offset]
    );

    const countResult = await db.query(
      'SELECT COUNT(*), AVG(rating)::NUMERIC(3,2) AS avg_rating FROM reviews WHERE item_type = $1 AND item_id = $2',
      [type, itemId]
    );

    const { count, avg_rating } = countResult.rows[0];

    res.json({
      data:       result.rows,
      total:      parseInt(count),
      avgRating:  parseFloat(avg_rating) || 0,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    });
  } catch (err) {
    console.error('Error en getReviews:', err);
    res.status(500).json({ error: 'Error al obtener reseñas' });
  }
};

// ============================================================
// POST /reviews
// Body: { item_type, item_id, rating (1-5), title, body }
// Solo se puede reseñar si hay una orden completada.
// ============================================================
const createReview = async (req, res) => {
  const { item_type, item_id, rating, title, body } = req.body;

  // Validaciones
  if (!item_type || !item_id || !rating) {
    return res.status(400).json({ error: 'item_type, item_id y rating son obligatorios' });
  }
  if (!['product', 'service'].includes(item_type)) {
    return res.status(400).json({ error: 'item_type debe ser "product" o "service"' });
  }
  const ratingNum = parseInt(rating);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'El rating debe ser un número entre 1 y 5' });
  }

  try {
    // Verificar que el item existe
    const table  = item_type === 'product' ? 'products' : 'services';
    const exists = await db.query(`SELECT id FROM ${table} WHERE id = $1`, [item_id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: `${item_type === 'product' ? 'Producto' : 'Servicio'} no encontrado` });
    }

    // Para productos: verificar que el usuario tiene una orden entregada
    if (item_type === 'product') {
      const orderCheck = await db.query(
        `SELECT id FROM orders
         WHERE buyer_id = $1 AND product_id = $2 AND status = 'delivered'
         LIMIT 1`,
        [req.user.id, item_id]
      );
      if (orderCheck.rows.length === 0) {
        return res.status(403).json({
          error: 'Solo podés reseñar productos que hayas comprado y recibido'
        });
      }
    }

    // Verificar que no haya reseñado ya este item
    const dupCheck = await db.query(
      'SELECT id FROM reviews WHERE reviewer_id = $1 AND item_type = $2 AND item_id = $3',
      [req.user.id, item_type, item_id]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Ya reseñaste este item' });
    }

    const result = await db.query(
      `INSERT INTO reviews (reviewer_id, item_type, item_id, rating, title, body)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.id, item_type, item_id, ratingNum, title || null, body || null]
    );

    res.status(201).json({
      message: 'Reseña publicada',
      review:  result.rows[0],
    });
  } catch (err) {
    console.error('Error en createReview:', err);
    res.status(500).json({ error: 'Error al crear reseña' });
  }
};

// ============================================================
// PUT /reviews/:id
// El autor puede editar su reseña.
// ============================================================
const updateReview = async (req, res) => {
  const { id }             = req.params;
  const { rating, title, body } = req.body;

  if (rating !== undefined) {
    const ratingNum = parseInt(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'El rating debe ser entre 1 y 5' });
    }
  }

  try {
    const check = await db.query('SELECT reviewer_id FROM reviews WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Reseña no encontrada' });
    if (check.rows[0].reviewer_id !== req.user.id) {
      return res.status(403).json({ error: 'No podés editar esta reseña' });
    }

    const result = await db.query(
      `UPDATE reviews SET
         rating     = COALESCE($1, rating),
         title      = COALESCE($2, title),
         body       = COALESCE($3, body),
         updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [rating || null, title || null, body || null, id]
    );

    res.json({ message: 'Reseña actualizada', review: result.rows[0] });
  } catch (err) {
    console.error('Error en updateReview:', err);
    res.status(500).json({ error: 'Error al actualizar reseña' });
  }
};

// ============================================================
// DELETE /reviews/:id
// El autor puede eliminar su reseña.
// ============================================================
const deleteReview = async (req, res) => {
  const { id } = req.params;

  try {
    const check = await db.query('SELECT reviewer_id FROM reviews WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Reseña no encontrada' });
    if (check.rows[0].reviewer_id !== req.user.id) {
      return res.status(403).json({ error: 'No podés eliminar esta reseña' });
    }

    await db.query('DELETE FROM reviews WHERE id = $1', [id]);
    res.json({ message: 'Reseña eliminada' });
  } catch (err) {
    console.error('Error en deleteReview:', err);
    res.status(500).json({ error: 'Error al eliminar reseña' });
  }
};

// ============================================================
// GET /reviews/user/:userId
// Todas las reseñas que recibió un usuario (en sus productos/servicios)
// ============================================================
const getUserReviews = async (req, res) => {
  const { userId } = req.params;
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(50, parseInt(req.query.limit) || 10);
  const offset = (page - 1) * limit;

  try {
    const result = await db.query(
      `SELECT
         r.id, r.rating, r.title, r.body, r.item_type, r.item_id, r.created_at,
         u.name AS reviewer_name, u.avatar_url AS reviewer_avatar,
         COALESCE(p.title, s.title) AS item_title
       FROM reviews r
       LEFT JOIN users u    ON r.reviewer_id = u.id
       LEFT JOIN products p ON r.item_type = 'product' AND r.item_id = p.id
       LEFT JOIN services s ON r.item_type = 'service' AND r.item_id = s.id
       WHERE
         (r.item_type = 'product' AND p.seller_id   = $1) OR
         (r.item_type = 'service' AND s.provider_id = $1)
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const stats = await db.query(
      `SELECT
         COUNT(*)                              AS total_reviews,
         AVG(r.rating)::NUMERIC(3,2)           AS avg_rating,
         COUNT(*) FILTER (WHERE r.rating = 5)  AS five_stars,
         COUNT(*) FILTER (WHERE r.rating = 4)  AS four_stars,
         COUNT(*) FILTER (WHERE r.rating = 3)  AS three_stars,
         COUNT(*) FILTER (WHERE r.rating <= 2) AS low_stars
       FROM reviews r
       LEFT JOIN products p ON r.item_type = 'product' AND r.item_id = p.id
       LEFT JOIN services s ON r.item_type = 'service' AND r.item_id = s.id
       WHERE
         (r.item_type = 'product' AND p.seller_id   = $1) OR
         (r.item_type = 'service' AND s.provider_id = $1)`,
      [userId]
    );

    res.json({
      data:      result.rows,
      stats:     stats.rows[0],
      page,
      limit,
    });
  } catch (err) {
    console.error('Error en getUserReviews:', err);
    res.status(500).json({ error: 'Error al obtener reseñas del usuario' });
  }
};

module.exports = { getReviews, createReview, updateReview, deleteReview, getUserReviews };
