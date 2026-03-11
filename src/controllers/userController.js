const db = require('../config/database');

// ============================================================
// GET /users/:id   - Perfil público
// ============================================================
const getUserById = async (req, res) => {
  const { id } = req.params;

  try {
    const userResult = await db.query(
      `SELECT id, name, avatar_url, location, created_at
       FROM users WHERE id = $1 AND is_active = true`,
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const user = userResult.rows[0];

    // Publicaciones del usuario
    const products = await db.query(
      `SELECT id, title, price, currency, images, condition, created_at
       FROM products WHERE seller_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 10`,
      [id]
    );

    const services = await db.query(
      `SELECT id, title, price_from, price_to, currency, price_type, images, created_at
       FROM services WHERE provider_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 10`,
      [id]
    );

    res.json({
      user,
      products: products.rows,
      services: services.rows
    });
  } catch (err) {
    console.error('Error en getUserById:', err);
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
};

// ============================================================
// PUT /users/me   - Actualizar perfil propio (requiere token)
// ============================================================
const updateProfile = async (req, res) => {
  const { name, phone, location, avatar_url } = req.body;

  try {
    const result = await db.query(
      `UPDATE users SET
         name       = COALESCE($1, name),
         phone      = COALESCE($2, phone),
         location   = COALESCE($3, location),
         avatar_url = COALESCE($4, avatar_url),
         updated_at = NOW()
       WHERE id = $5
       RETURNING id, name, email, phone, location, avatar_url, updated_at`,
      [name, phone, location, avatar_url, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en updateProfile:', err);
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
};

// ============================================================
// GET /users/me/products   - Mis publicaciones (requiere token)
// ============================================================
const getMyProducts = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.*, pc.name AS category_name
       FROM products p
       LEFT JOIN product_categories pc ON p.category_id = pc.id
       WHERE p.seller_id = $1
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener tus productos' });
  }
};

// ============================================================
// GET /users/me/services   - Mis servicios (requiere token)
// ============================================================
const getMyServices = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT s.*, sc.name AS category_name
       FROM services s
       LEFT JOIN service_categories sc ON s.category_id = sc.id
       WHERE s.provider_id = $1
       ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener tus servicios' });
  }
};

module.exports = { getUserById, updateProfile, getMyProducts, getMyServices };
