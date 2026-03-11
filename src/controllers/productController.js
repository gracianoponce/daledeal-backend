const db = require('../config/database');

// ============================================================
// GET /products
// Query params opcionales: category, search, condition, page, limit
// ============================================================
const getProducts = async (req, res) => {
  const {
    category,
    search,
    condition,
    page  = 1,
    limit = 20
  } = req.query;

  const offset = (page - 1) * limit;
  const params = [];
  const conditions = ["p.status = 'active'"];

  if (category) {
    params.push(category);
    conditions.push(`pc.slug = $${params.length}`);
  }
  if (condition) {
    params.push(condition);
    conditions.push(`p.condition = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(p.title ILIKE $${params.length} OR p.description ILIKE $${params.length})`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(limit, offset);

  try {
    const result = await db.query(
      `SELECT
         p.id, p.title, p.price, p.currency, p.condition, p.images,
         p.location, p.views, p.created_at,
         pc.name AS category_name, pc.slug AS category_slug,
         u.id AS seller_id, u.name AS seller_name, u.avatar_url AS seller_avatar
       FROM products p
       LEFT JOIN product_categories pc ON p.category_id = pc.id
       LEFT JOIN users u ON p.seller_id = u.id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    // Contar total para paginación
    const countParams = params.slice(0, -2);
    const countResult = await db.query(
      `SELECT COUNT(*) FROM products p
       LEFT JOIN product_categories pc ON p.category_id = pc.id
       ${where}`,
      countParams
    );

    res.json({
      data:       result.rows,
      total:      parseInt(countResult.rows[0].count),
      page:       parseInt(page),
      limit:      parseInt(limit),
      totalPages: Math.ceil(countResult.rows[0].count / limit)
    });
  } catch (err) {
    console.error('Error en getProducts:', err);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
};

// ============================================================
// GET /products/:id
// ============================================================
const getProductById = async (req, res) => {
  const { id } = req.params;

  try {
    // Incrementar vistas
    await db.query('UPDATE products SET views = views + 1 WHERE id = $1', [id]);

    const result = await db.query(
      `SELECT
         p.*,
         pc.name AS category_name, pc.slug AS category_slug,
         u.id AS seller_id, u.name AS seller_name,
         u.avatar_url AS seller_avatar, u.phone AS seller_phone,
         u.location AS seller_location, u.created_at AS seller_since
       FROM products p
       LEFT JOIN product_categories pc ON p.category_id = pc.id
       LEFT JOIN users u ON p.seller_id = u.id
       WHERE p.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en getProductById:', err);
    res.status(500).json({ error: 'Error al obtener producto' });
  }
};

// ============================================================
// POST /products  (requiere token)
// ============================================================
const createProduct = async (req, res) => {
  const {
    title, description, price, currency = 'ARS',
    stock = 0, condition = 'new', category_id,
    images = [], location
  } = req.body;

  if (!title || !price) {
    return res.status(400).json({ error: 'Título y precio son obligatorios' });
  }

  try {
    const result = await db.query(
      `INSERT INTO products
         (title, description, price, currency, stock, condition, category_id, seller_id, images, location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [title, description, price, currency, stock, condition, category_id || null, req.user.id, images, location]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error en createProduct:', err);
    res.status(500).json({ error: 'Error al crear producto' });
  }
};

// ============================================================
// PUT /products/:id  (requiere token, solo el vendedor)
// ============================================================
const updateProduct = async (req, res) => {
  const { id } = req.params;
  const { title, description, price, stock, condition, category_id, images, location, status } = req.body;

  try {
    // Verificar que el producto pertenezca al usuario
    const check = await db.query('SELECT seller_id FROM products WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    if (check.rows[0].seller_id !== req.user.id) return res.status(403).json({ error: 'No tenés permiso para editar este producto' });

    const result = await db.query(
      `UPDATE products SET
         title       = COALESCE($1, title),
         description = COALESCE($2, description),
         price       = COALESCE($3, price),
         stock       = COALESCE($4, stock),
         condition   = COALESCE($5, condition),
         category_id = COALESCE($6, category_id),
         images      = COALESCE($7, images),
         location    = COALESCE($8, location),
         status      = COALESCE($9, status),
         updated_at  = NOW()
       WHERE id = $10
       RETURNING *`,
      [title, description, price, stock, condition, category_id, images, location, status, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en updateProduct:', err);
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
};

// ============================================================
// DELETE /products/:id  (requiere token, solo el vendedor)
// ============================================================
const deleteProduct = async (req, res) => {
  const { id } = req.params;

  try {
    const check = await db.query('SELECT seller_id FROM products WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    if (check.rows[0].seller_id !== req.user.id) return res.status(403).json({ error: 'No tenés permiso' });

    await db.query('DELETE FROM products WHERE id = $1', [id]);
    res.json({ message: 'Producto eliminado' });
  } catch (err) {
    console.error('Error en deleteProduct:', err);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
};

// ============================================================
// GET /products/categories
// ============================================================
const getCategories = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM product_categories ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener categorías' });
  }
};

module.exports = { getProducts, getProductById, createProduct, updateProduct, deleteProduct, getCategories };
