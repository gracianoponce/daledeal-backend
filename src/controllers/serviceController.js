const db = require('../config/database');
const { validateSafeUrl } = require('../middleware/validate');

const ALLOWED_PRICE_TYPES = ['fixed', 'hourly', 'quote'];
const ALLOWED_CURRENCIES  = ['ARS', 'USD'];
const MAX_PRICE           = 999_999_999;
const MAX_IMAGES          = 20;
const MAX_ZONES           = 50;
const MAX_TITLE_LEN       = 200;
const MAX_DESC_LEN        = 5_000;
const MAX_LOCATION_LEN    = 150;

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Valida los campos comunes de un servicio. Estricto en CREATE
 * (title obligatorio), permisivo en UPDATE.
 */
function validateServiceFields(b, { mode = 'create' } = {}) {
  const isCreate = mode === 'create';

  if (b.title !== undefined || isCreate) {
    if (typeof b.title !== 'string' || b.title.trim().length < 3 || b.title.length > MAX_TITLE_LEN) {
      return { ok: false, error: `El título debe tener entre 3 y ${MAX_TITLE_LEN} caracteres` };
    }
  }
  if (b.description !== undefined && b.description !== null) {
    if (typeof b.description !== 'string' || b.description.length > MAX_DESC_LEN) {
      return { ok: false, error: `La descripción no puede superar los ${MAX_DESC_LEN} caracteres` };
    }
  }
  const pf = num(b.price_from);
  const pt = num(b.price_to);
  if (Number.isNaN(pf) || (pf !== null && (pf <= 0 || pf > MAX_PRICE))) {
    return { ok: false, error: 'price_from debe ser un número mayor a 0' };
  }
  if (Number.isNaN(pt) || (pt !== null && (pt <= 0 || pt > MAX_PRICE))) {
    return { ok: false, error: 'price_to debe ser un número mayor a 0' };
  }
  if (pf !== null && pt !== null && pt < pf) {
    return { ok: false, error: 'price_to no puede ser menor a price_from' };
  }
  if (b.currency !== undefined && !ALLOWED_CURRENCIES.includes(b.currency)) {
    return { ok: false, error: `currency inválida (permitidas: ${ALLOWED_CURRENCIES.join(', ')})` };
  }
  if (b.price_type !== undefined && !ALLOWED_PRICE_TYPES.includes(b.price_type)) {
    return { ok: false, error: `price_type debe ser uno de: ${ALLOWED_PRICE_TYPES.join(', ')}` };
  }
  if (b.images !== undefined && b.images !== null) {
    if (!Array.isArray(b.images) || b.images.length > MAX_IMAGES) {
      return { ok: false, error: `images debe ser un array de hasta ${MAX_IMAGES} URLs` };
    }
    for (const img of b.images) {
      const v = validateSafeUrl(img);
      if (!v.ok) return { ok: false, error: 'Una imagen tiene URL inválida' };
    }
  }
  if (b.zones_covered !== undefined && b.zones_covered !== null) {
    if (!Array.isArray(b.zones_covered) || b.zones_covered.length > MAX_ZONES) {
      return { ok: false, error: `zones_covered debe ser un array de hasta ${MAX_ZONES} zonas` };
    }
  }
  if (b.location !== undefined && b.location !== null) {
    if (typeof b.location !== 'string' || b.location.length > MAX_LOCATION_LEN) {
      return { ok: false, error: `location no puede superar ${MAX_LOCATION_LEN} caracteres` };
    }
  }
  if (b.category_id !== undefined && b.category_id !== null) {
    const c = parseInt(b.category_id, 10);
    if (!Number.isInteger(c) || c < 1) {
      return { ok: false, error: 'category_id inválido' };
    }
  }
  return { ok: true };
}

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
         u.id AS provider_id, u.name AS provider_name, u.avatar_url AS provider_avatar,
         COALESCE(rs.avg_rating, 0)::FLOAT  AS avg_rating,
         COALESCE(rs.review_count, 0)::INT AS review_count
       FROM services s
       LEFT JOIN service_categories sc ON s.category_id = sc.id
       LEFT JOIN users u ON s.provider_id = u.id
       LEFT JOIN (
         SELECT item_id,
                AVG(rating)::NUMERIC(3,2) AS avg_rating,
                COUNT(*)                   AS review_count
           FROM reviews
          WHERE item_type = 'service'
          GROUP BY item_id
       ) rs ON rs.item_id = s.id
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
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'id inválido' });
  }

  try {
    db.query('UPDATE services SET views = views + 1 WHERE id = $1', [id]).catch(() => {});

    const result = await db.query(
      `SELECT
         s.*,
         sc.name AS category_name, sc.slug AS category_slug,
         u.id AS provider_id, u.name AS provider_name,
         u.avatar_url AS provider_avatar, u.phone AS provider_phone,
         u.location AS provider_location, u.created_at AS provider_since,
         COALESCE(rs.avg_rating, 0)::FLOAT  AS avg_rating,
         COALESCE(rs.review_count, 0)::INT AS review_count
       FROM services s
       LEFT JOIN service_categories sc ON s.category_id = sc.id
       LEFT JOIN users u ON s.provider_id = u.id
       LEFT JOIN (
         SELECT item_id,
                AVG(rating)::NUMERIC(3,2) AS avg_rating,
                COUNT(*)                   AS review_count
           FROM reviews
          WHERE item_type = 'service'
          GROUP BY item_id
       ) rs ON rs.item_id = s.id
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

  // Validar tipos y rangos
  const v = validateServiceFields(req.body, { mode: 'create' });
  if (!v.ok) return res.status(400).json({ error: v.error });

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

    const v = validateServiceFields(req.body, { mode: 'update' });
    if (!v.ok) return res.status(400).json({ error: v.error });

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
