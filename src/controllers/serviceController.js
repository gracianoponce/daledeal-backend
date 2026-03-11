const db = require('../config/database');

// ============================================================
// GET /services
// Query params: category, search, location, page, limit
// ============================================================
const getServices = async (req, res) => {
  const {
    category,
    search,
    location,
    page  = 1,
    limit = 20
  } = req.query;

  const offset = (page - 1) * limit;
  const params = [];
  const conditions = ["s.status = 'active'"];

  if (category) {
    params.push(category);
    conditions.push(`sc.slug = $${params.length}`);
  }
  if (location) {
    params.push(`%${location}%`);
    conditions.push(`s.location ILIKE $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(s.title ILIKE $${params.length} OR s.description ILIKE $${params.length})`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(limit, offset);

  try {
    const result = await db.query(
      `SELECT
         s.id, s.title, s.price_from, s.price_to, s.currency, s.price_type,
         s.images, s.location, s.zones_covered, s.views, s.created_at,
         sc.name AS category_name, sc.slug AS category_slug,
         u.id AS provider_id, u.name AS provider_name, u.avatar_url AS provider_avatar
       FROM services s
       LEFT JOIN service_categories sc ON s.category_id = sc.id
       LEFT JOIN users u ON s.provider_id = u.id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, -2);
    const countResult = await db.query(
      `SELECT COUNT(*) FROM services s
       LEFT JOIN service_categories sc ON s.category_id = sc.id
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
    console.error('Error en getServices:', err);
    res.status(500).json({ error: 'Error al obtener servicios' });
  }
};

// ============================================================
// GET /services/:id
// ============================================================
const getServiceById = async (req, res) => {
  const { id } = req.params;

  try {
    await db.query('UPDATE services SET views = views + 1 WHERE id = $1', [id]);

    const result = await db.query(
      `SELECT
         s.*,
         sc.name AS category_name, sc.slug AS category_slug,
         u.id AS provider_id, u.name AS provider_name,
         u.avatar_url AS provider_avatar, u.phone AS provider_phone,
         u.location AS provider_location, u.created_at AS provider_since
       FROM services s
       LEFT JOIN service_categories sc ON s.category_id = sc.id
       LEFT JOIN users u ON s.provider_id = u.id
       WHERE s.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en getServiceById:', err);
    res.status(500).json({ error: 'Error al obtener servicio' });
  }
};

// ============================================================
// POST /services  (requiere token)
// ============================================================
const createService = async (req, res) => {
  const {
    title, description,
    price_from, price_to, currency = 'ARS', price_type = 'fixed',
    category_id, images = [], location, zones_covered = []
  } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'El título es obligatorio' });
  }

  try {
    const result = await db.query(
      `INSERT INTO services
         (title, description, price_from, price_to, currency, price_type,
          category_id, provider_id, images, location, zones_covered)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        title, description, price_from || null, price_to || null,
        currency, price_type, category_id || null, req.user.id,
        images, location, zones_covered
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error en createService:', err);
    res.status(500).json({ error: 'Error al crear servicio' });
  }
};

// ============================================================
// PUT /services/:id  (requiere token, solo el proveedor)
// ============================================================
const updateService = async (req, res) => {
  const { id } = req.params;
  const { title, description, price_from, price_to, price_type, category_id, images, location, zones_covered, status } = req.body;

  try {
    const check = await db.query('SELECT provider_id FROM services WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (check.rows[0].provider_id !== req.user.id) return res.status(403).json({ error: 'No tenés permiso para editar este servicio' });

    const result = await db.query(
      `UPDATE services SET
         title         = COALESCE($1, title),
         description   = COALESCE($2, description),
         price_from    = COALESCE($3, price_from),
         price_to      = COALESCE($4, price_to),
         price_type    = COALESCE($5, price_type),
         category_id   = COALESCE($6, category_id),
         images        = COALESCE($7, images),
         location      = COALESCE($8, location),
         zones_covered = COALESCE($9, zones_covered),
         status        = COALESCE($10, status),
         updated_at    = NOW()
       WHERE id = $11
       RETURNING *`,
      [title, description, price_from, price_to, price_type, category_id, images, location, zones_covered, status, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en updateService:', err);
    res.status(500).json({ error: 'Error al actualizar servicio' });
  }
};

// ============================================================
// DELETE /services/:id  (requiere token)
// ============================================================
const deleteService = async (req, res) => {
  const { id } = req.params;

  try {
    const check = await db.query('SELECT provider_id FROM services WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (check.rows[0].provider_id !== req.user.id) return res.status(403).json({ error: 'No tenés permiso' });

    await db.query('DELETE FROM services WHERE id = $1', [id]);
    res.json({ message: 'Servicio eliminado' });
  } catch (err) {
    console.error('Error en deleteService:', err);
    res.status(500).json({ error: 'Error al eliminar servicio' });
  }
};

// ============================================================
// GET /services/categories
// ============================================================
const getCategories = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM service_categories ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener categorías' });
  }
};

module.exports = { getServices, getServiceById, createService, updateService, deleteService, getCategories };
