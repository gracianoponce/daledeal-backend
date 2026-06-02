const db = require('../config/database');
const { parsePagination, parseSortOrder, validateSafeUrl } = require('../middleware/validate');

const ALLOWED_CONDITIONS = ['new', 'used'];
const ALLOWED_CURRENCIES = ['ARS', 'USD'];
const MAX_PRICE          = 999_999_999;     // 999M (cubre cualquier producto razonable)
const MAX_STOCK          = 100_000;
const MAX_IMAGES         = 20;
const MAX_TITLE_LEN      = 200;
const MAX_DESC_LEN       = 5_000;
const MAX_LOCATION_LEN   = 150;

/**
 * Valida los campos comunes de un producto al crear/editar.
 * Devuelve { ok:true } o { ok:false, error }.
 *
 * Estricto en CREATE (todos obligatorios), permisivo en UPDATE
 * (solo valida si el campo viene definido).
 */
function validateProductFields(b, { mode = 'create' } = {}) {
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
  if (b.price !== undefined || isCreate) {
    const p = parseFloat(b.price);
    if (!Number.isFinite(p) || p <= 0 || p > MAX_PRICE) {
      return { ok: false, error: 'El precio debe ser un número mayor a 0' };
    }
  }
  if (b.currency !== undefined && !ALLOWED_CURRENCIES.includes(b.currency)) {
    return { ok: false, error: `currency inválida (permitidas: ${ALLOWED_CURRENCIES.join(', ')})` };
  }
  if (b.stock !== undefined) {
    const s = parseInt(b.stock, 10);
    if (!Number.isInteger(s) || s < 0 || s > MAX_STOCK) {
      return { ok: false, error: `stock debe ser un entero entre 0 y ${MAX_STOCK}` };
    }
  }
  if (b.condition !== undefined && !ALLOWED_CONDITIONS.includes(b.condition)) {
    return { ok: false, error: `condition debe ser uno de: ${ALLOWED_CONDITIONS.join(', ')}` };
  }
  if (b.images !== undefined && b.images !== null) {
    if (!Array.isArray(b.images)) {
      return { ok: false, error: 'images debe ser un array de URLs' };
    }
    if (b.images.length > MAX_IMAGES) {
      return { ok: false, error: `Máximo ${MAX_IMAGES} imágenes por publicación` };
    }
    for (const img of b.images) {
      const v = validateSafeUrl(img);
      if (!v.ok) return { ok: false, error: 'Una imagen tiene URL inválida' };
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

// ------------------------------------------------------------
// Helper: valida y normaliza los campos de envío que llegan
// del cliente al crear/editar producto.
//
// Reglas:
//  - Si shipping_required = false → no se ofrecen métodos.
//  - Si shipping_required = true → al menos uno de
//    offers_delivery / offers_pickup tiene que ser true.
//  - Si offers_delivery → shipping_cost numérico ≥ 0.
//  - Si offers_pickup   → pickup_address con contenido.
//
// Devuelve { ok:true, fields } o { ok:false, error }.
// ------------------------------------------------------------
function normalizeShippingFields({
  shipping_required,
  offers_delivery,
  offers_pickup,
  shipping_cost,
  pickup_address,
}) {
  const required = Boolean(shipping_required);

  if (!required) {
    return {
      ok: true,
      fields: {
        shipping_required: false,
        offers_delivery:   false,
        offers_pickup:     false,
        shipping_cost:     null,
        pickup_address:    null,
      },
    };
  }

  const delivery = Boolean(offers_delivery);
  const pickup   = Boolean(offers_pickup);

  if (!delivery && !pickup) {
    return {
      ok:    false,
      error: 'Si el producto requiere envío, tenés que ofrecer al menos un método (envío o retiro)',
    };
  }

  let cost = null;
  if (delivery) {
    cost = parseFloat(shipping_cost);
    if (Number.isNaN(cost) || cost < 0) {
      return {
        ok:    false,
        error: 'shipping_cost es obligatorio y debe ser ≥ 0 cuando ofrece envío',
      };
    }
  }

  let pickup_addr = null;
  if (pickup) {
    pickup_addr = String(pickup_address || '').trim();
    if (!pickup_addr) {
      return {
        ok:    false,
        error: 'pickup_address es obligatorio cuando se ofrece retiro en persona',
      };
    }
  }

  return {
    ok: true,
    fields: {
      shipping_required: true,
      offers_delivery:   delivery,
      offers_pickup:     pickup,
      shipping_cost:     cost,
      pickup_address:    pickup_addr,
    },
  };
}

// ============================================================
// GET /products
// Query params: category, search, condition, min_price, max_price,
//               sort (price|title|views|created_at), order (asc|desc),
//               page, limit
// ============================================================
const getProducts = async (req, res) => {
  const {
    category,
    search,
    condition,
    min_price,
    max_price,
    seller_id,
  } = req.query;

  const { page, limit, offset } = parsePagination(req.query);
  const { field, order }        = parseSortOrder(req.query, ['price', 'title', 'views', 'created_at']);

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
  if (min_price) {
    const mp = parseFloat(min_price);
    if (Number.isFinite(mp) && mp >= 0) {
      params.push(mp);
      conditions.push(`p.price >= $${params.length}`);
    }
  }
  if (max_price) {
    const mp = parseFloat(max_price);
    if (Number.isFinite(mp) && mp >= 0) {
      params.push(mp);
      conditions.push(`p.price <= $${params.length}`);
    }
  }
  if (seller_id) {
    const sid = parseInt(seller_id, 10);
    if (Number.isInteger(sid) && sid > 0) {
      params.push(sid);
      conditions.push(`p.seller_id = $${params.length}`);
    }
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(limit, offset);

  try {
    const result = await db.query(
      `SELECT
         p.id, p.title, p.price, p.currency, p.condition, p.images,
         p.location, p.views, p.created_at,
         p.shipping_required, p.offers_delivery, p.offers_pickup,
         p.shipping_cost, p.pickup_address,
         -- LEFT en lugar de description completo: en el listado solo
         -- necesitamos ~80 chars para el preview de la card. Evita traer
         -- descripciones largas (hasta varios KB) por cada item.
         LEFT(p.description, 160) AS description,
         pc.name AS category_name, pc.slug AS category_slug,
         u.id AS seller_id, u.name AS seller_name, u.avatar_url AS seller_avatar,
         COALESCE(rs.avg_rating, 0)::FLOAT  AS avg_rating,
         COALESCE(rs.review_count, 0)::INT AS review_count
       FROM products p
       LEFT JOIN product_categories pc ON p.category_id = pc.id
       LEFT JOIN users u ON p.seller_id = u.id
       LEFT JOIN (
         SELECT item_id,
                AVG(rating)::NUMERIC(3,2) AS avg_rating,
                COUNT(*)                   AS review_count
           FROM reviews
          WHERE item_type = 'product'
          GROUP BY item_id
       ) rs ON rs.item_id = p.id
       ${where}
       ORDER BY p.${field} ${order}
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
      page,
      limit,
      totalPages: Math.ceil(countResult.rows[0].count / limit),
      sort:       { field, order },
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
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'id inválido' });
  }

  try {
    // Incrementar vistas (no crítico — si falla, seguimos)
    db.query('UPDATE products SET views = views + 1 WHERE id = $1', [id]).catch(() => {});

    const result = await db.query(
      `SELECT
         p.*,
         pc.name AS category_name, pc.slug AS category_slug,
         u.id AS seller_id, u.name AS seller_name,
         u.avatar_url AS seller_avatar, u.phone AS seller_phone,
         u.location AS seller_location, u.created_at AS seller_since,
         COALESCE(rs.avg_rating, 0)::FLOAT  AS avg_rating,
         COALESCE(rs.review_count, 0)::INT AS review_count
       FROM products p
       LEFT JOIN product_categories pc ON p.category_id = pc.id
       LEFT JOIN users u ON p.seller_id = u.id
       LEFT JOIN (
         SELECT item_id,
                AVG(rating)::NUMERIC(3,2) AS avg_rating,
                COUNT(*)                   AS review_count
           FROM reviews
          WHERE item_type = 'product'
          GROUP BY item_id
       ) rs ON rs.item_id = p.id
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
    images = [], location,
    // Campos de envío (todos opcionales; default = sin envío)
    shipping_required, offers_delivery, offers_pickup,
    shipping_cost, pickup_address,
  } = req.body;

  if (!title || !price) {
    return res.status(400).json({ error: 'Título y precio son obligatorios' });
  }

  // Validar tipos de los campos comunes (precio, stock, condition, urls, etc.)
  const v = validateProductFields(req.body, { mode: 'create' });
  if (!v.ok) return res.status(400).json({ error: v.error });

  // Normalizar y validar opciones de envío
  const ship = normalizeShippingFields({
    shipping_required, offers_delivery, offers_pickup,
    shipping_cost, pickup_address,
  });
  if (!ship.ok) return res.status(400).json({ error: ship.error });

  try {
    const result = await db.query(
      `INSERT INTO products
         (title, description, price, currency, stock, condition,
          category_id, seller_id, images, location,
          shipping_required, offers_delivery, offers_pickup,
          shipping_cost, pickup_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        title, description, price, currency, stock, condition,
        category_id || null, req.user.id, images, location,
        ship.fields.shipping_required, ship.fields.offers_delivery,
        ship.fields.offers_pickup, ship.fields.shipping_cost,
        ship.fields.pickup_address,
      ]
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
  const {
    title, description, price, stock, condition, category_id,
    images, location, status,
    // Campos de envío: si shipping_required viene definido,
    // reescribimos todo el bloque de envío con validación.
    shipping_required, offers_delivery, offers_pickup,
    shipping_cost, pickup_address,
  } = req.body;

  try {
    // Verificar que el producto pertenezca al usuario
    const check = await db.query('SELECT seller_id FROM products WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    if (check.rows[0].seller_id !== req.user.id) return res.status(403).json({ error: 'No tenés permiso para editar este producto' });

    // Validar tipos de los campos enviados (cualquier subset)
    const v = validateProductFields(req.body, { mode: 'update' });
    if (!v.ok) return res.status(400).json({ error: v.error });

    // ¿El cliente está modificando la configuración de envío?
    const touchingShipping = shipping_required !== undefined;
    let ship = null;
    if (touchingShipping) {
      ship = normalizeShippingFields({
        shipping_required, offers_delivery, offers_pickup,
        shipping_cost, pickup_address,
      });
      if (!ship.ok) return res.status(400).json({ error: ship.error });
    }

    const result = await db.query(
      `UPDATE products SET
         title             = COALESCE($1, title),
         description       = COALESCE($2, description),
         price             = COALESCE($3, price),
         stock             = COALESCE($4, stock),
         condition         = COALESCE($5, condition),
         category_id       = COALESCE($6, category_id),
         images            = COALESCE($7, images),
         location          = COALESCE($8, location),
         status            = COALESCE($9, status),
         shipping_required = COALESCE($11, shipping_required),
         offers_delivery   = COALESCE($12, offers_delivery),
         offers_pickup     = COALESCE($13, offers_pickup),
         shipping_cost     = CASE WHEN $11 IS NULL THEN shipping_cost  ELSE $14 END,
         pickup_address    = CASE WHEN $11 IS NULL THEN pickup_address ELSE $15 END,
         updated_at        = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        title, description, price, stock, condition, category_id,
        images, location, status, id,
        ship ? ship.fields.shipping_required : null,
        ship ? ship.fields.offers_delivery   : null,
        ship ? ship.fields.offers_pickup     : null,
        ship ? ship.fields.shipping_cost     : null,
        ship ? ship.fields.pickup_address    : null,
      ]
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
