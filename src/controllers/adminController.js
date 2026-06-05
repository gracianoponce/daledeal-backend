const db = require('../config/database');

// ============================================================
// GET /admin/stats — Dashboard
// Resumen agregado del marketplace
// ============================================================
// Helper: ejecuta una query opcional. Si la tabla no existe (42P01) devuelve
// fallback (default 0). Útil para sumar stats de tablas que pueden o no estar
// creadas según el estado de las migrations.
async function tryCount(query, fallback = 0) {
  try {
    const r = await db.query(query);
    return r.rows[0]?.n != null ? r.rows[0].n : (r.rows[0]?.count ?? fallback);
  } catch (err) {
    if (err.code === '42P01') return fallback;
    throw err;
  }
}

// ============================================================
// GET /admin/stats/timeseries?days=30
// Datos diarios de los últimos N días (default 30, max 365):
// - new_users:       cuentas creadas
// - new_orders:      órdenes creadas
// - orders_paid:     órdenes que cambiaron a paid (paid_at)
// - revenue:         GMV acreditado ese día
// - new_leads:       leads B2B nuevos (tolerante a tabla inexistente)
// - new_subscribers: suscriptores newsletter (tolerante a tabla inexistente)
//
// Usado por dashboard admin para charts (futuro). Devuelve array ordenado
// por fecha ASC, con buckets vacíos rellenados a 0 (para que charts no
// muestren huecos).
// ============================================================
const getStatsTimeseries = async (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  try {
    // generate_series rellena días sin datos con 0 — el chart queda continuo.
    const r = await db.query(`
      WITH days AS (
        SELECT generate_series(
          (CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day')::date,
          CURRENT_DATE::date,
          INTERVAL '1 day'
        )::date AS day
      )
      SELECT
        d.day,
        COALESCE((SELECT COUNT(*)::int FROM users
                  WHERE created_at::date = d.day), 0) AS new_users,
        COALESCE((SELECT COUNT(*)::int FROM orders
                  WHERE created_at::date = d.day), 0) AS new_orders,
        COALESCE((SELECT COUNT(*)::int FROM orders
                  WHERE paid_at::date = d.day), 0) AS orders_paid,
        COALESCE((SELECT SUM(total_price)::float FROM orders
                  WHERE paid_at::date = d.day AND payment_status = 'paid'), 0) AS revenue
      FROM days d
      ORDER BY d.day ASC
    `, [days]);

    // Las tablas company_leads y newsletter_subscribers son nuevas — pueden
    // no existir aún. Las consultamos por separado con tryCount-style.
    let newLeadsByDay = {};
    let newSubscribersByDay = {};
    try {
      const rl = await db.query(`
        SELECT created_at::date AS day, COUNT(*)::int AS n
          FROM company_leads
         WHERE created_at >= CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day'
         GROUP BY day`,
        [days]);
      rl.rows.forEach(row => { newLeadsByDay[row.day.toISOString().slice(0,10)] = row.n; });
    } catch (e) { if (e.code !== '42P01') throw e; }
    try {
      const rs = await db.query(`
        SELECT created_at::date AS day, COUNT(*)::int AS n
          FROM newsletter_subscribers
         WHERE created_at >= CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day'
         GROUP BY day`,
        [days]);
      rs.rows.forEach(row => { newSubscribersByDay[row.day.toISOString().slice(0,10)] = row.n; });
    } catch (e) { if (e.code !== '42P01') throw e; }

    res.json({
      days,
      data: r.rows.map(row => {
        const dayKey = row.day.toISOString().slice(0, 10);
        return {
          day:             dayKey,
          new_users:       row.new_users,
          new_orders:      row.new_orders,
          orders_paid:     row.orders_paid,
          revenue:         Number(row.revenue) || 0,
          new_leads:       newLeadsByDay[dayKey] || 0,
          new_subscribers: newSubscribersByDay[dayKey] || 0,
        };
      }),
    });
  } catch (err) {
    console.error('[admin/stats/timeseries] Error:', err);
    res.status(500).json({ error: 'Error al obtener timeseries' });
  }
};

const getStats = async (req, res) => {
  try {
    const queries = await Promise.all([
      db.query('SELECT COUNT(*)::int AS n FROM users WHERE is_active = true'),
      db.query("SELECT COUNT(*)::int AS n FROM products WHERE status = 'active'"),
      db.query("SELECT COUNT(*)::int AS n FROM services WHERE status = 'active'"),
      db.query('SELECT COUNT(*)::int AS n FROM orders'),
      db.query("SELECT COUNT(*)::int AS n FROM orders WHERE payment_status = 'paid'"),
      db.query("SELECT COALESCE(SUM(total_price), 0)::numeric AS gmv FROM orders WHERE payment_status = 'paid'"),
      db.query("SELECT COALESCE(SUM(commission_amount), 0)::numeric AS commission FROM orders WHERE payment_status = 'paid'"),
      db.query('SELECT COUNT(*)::int AS n FROM reviews'),
      db.query("SELECT COUNT(*)::int AS n FROM users WHERE created_at > NOW() - INTERVAL '7 days'"),
      db.query("SELECT COUNT(*)::int AS n FROM orders WHERE created_at > NOW() - INTERVAL '7 days'"),
      // Stats agregadas en sprints recientes — son tolerantes a tabla
      // inexistente (devuelven 0 si la migration no se aplicó todavía)
      tryCount("SELECT COUNT(*)::int AS n FROM company_leads"),
      tryCount("SELECT COUNT(*)::int AS n FROM company_leads WHERE status = 'new'"),
      tryCount("SELECT COUNT(*)::int AS n FROM newsletter_subscribers WHERE unsubscribed_at IS NULL"),
    ]);

    res.json({
      users:               queries[0].rows[0].n,
      products_active:     queries[1].rows[0].n,
      services_active:     queries[2].rows[0].n,
      orders_total:        queries[3].rows[0].n,
      orders_paid:         queries[4].rows[0].n,
      gmv_ars:             parseFloat(queries[5].rows[0].gmv),
      commission_ars:      parseFloat(queries[6].rows[0].commission),
      reviews_total:       queries[7].rows[0].n,
      new_users_7d:        queries[8].rows[0].n,
      new_orders_7d:       queries[9].rows[0].n,
      // Nuevas métricas
      b2b_leads_total:     queries[10],
      b2b_leads_new:       queries[11],
      newsletter_active:   queries[12],
    });
  } catch (err) {
    console.error('Error en admin getStats:', err);
    res.status(500).json({ error: 'Error al obtener stats' });
  }
};

// ============================================================
// GET /admin/users — Listar usuarios con paginación + búsqueda
// ============================================================
const listUsers = async (req, res) => {
  const { search = '', role, status, page = 1, limit = 20 } = req.query;
  const lim    = Math.min(parseInt(limit, 10) || 20, 100);
  const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * lim;

  const params = [];
  const conditions = [];
  if (search.trim()) {
    params.push(`%${search.trim()}%`);
    conditions.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }
  if (role)   { params.push(role);   conditions.push(`role = $${params.length}`); }
  if (status === 'active')    conditions.push('is_active = true');
  if (status === 'suspended') conditions.push('is_active = false');

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(lim, offset);

  try {
    const result = await db.query(
      `SELECT id, name, email, phone, location, role, is_active, created_at,
              (SELECT COUNT(*)::int FROM products WHERE seller_id   = users.id AND status='active') AS product_count,
              (SELECT COUNT(*)::int FROM services WHERE provider_id = users.id AND status='active') AS service_count,
              (SELECT COUNT(*)::int FROM orders   WHERE buyer_id    = users.id) AS purchase_count
         FROM users
         ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, -2);
    const countRes = await db.query(
      `SELECT COUNT(*)::int AS total FROM users ${where}`,
      countParams
    );

    res.json({
      data:       result.rows,
      total:      countRes.rows[0].total,
      page:       parseInt(page, 10) || 1,
      limit:      lim,
      totalPages: Math.ceil(countRes.rows[0].total / lim),
    });
  } catch (err) {
    console.error('Error en admin listUsers:', err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
};

// ============================================================
// PATCH /admin/users/:id — Modificar usuario (suspender, cambiar rol)
// Body: { is_active?, role? }
// ============================================================
const updateUser = async (req, res) => {
  const { id } = req.params;
  const { is_active, role } = req.body;

  if (parseInt(id, 10) === req.user.id) {
    return res.status(400).json({ error: 'No podés modificar tu propia cuenta de admin desde acá' });
  }

  if (role && !['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: "role debe ser 'user' o 'admin'" });
  }

  try {
    const result = await db.query(
      `UPDATE users
          SET is_active = COALESCE($1, is_active),
              role      = COALESCE($2, role),
              updated_at = NOW()
        WHERE id = $3
        RETURNING id, name, email, role, is_active`,
      [
        typeof is_active === 'boolean' ? is_active : null,
        role || null,
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ message: 'Usuario actualizado', user: result.rows[0] });
  } catch (err) {
    console.error('Error en admin updateUser:', err);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
};

// ============================================================
// GET /admin/products — Listar productos (incluye no activos)
// ============================================================
const listProducts = async (req, res) => {
  const { search = '', status, page = 1, limit = 20 } = req.query;
  const lim    = Math.min(parseInt(limit, 10) || 20, 100);
  const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * lim;

  const params = [];
  const conditions = [];
  if (search.trim()) {
    params.push(`%${search.trim()}%`);
    conditions.push(`(p.title ILIKE $${params.length} OR p.description ILIKE $${params.length})`);
  }
  if (status) { params.push(status); conditions.push(`p.status = $${params.length}`); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(lim, offset);

  try {
    const result = await db.query(
      `SELECT p.id, p.title, p.price, p.currency, p.status, p.stock,
              p.created_at, p.images,
              u.id   AS seller_id,
              u.name AS seller_name,
              u.email AS seller_email
         FROM products p
         LEFT JOIN users u ON u.id = p.seller_id
         ${where}
        ORDER BY p.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, -2);
    const countRes = await db.query(
      `SELECT COUNT(*)::int AS total FROM products p ${where}`,
      countParams
    );

    res.json({
      data:       result.rows,
      total:      countRes.rows[0].total,
      page:       parseInt(page, 10) || 1,
      limit:      lim,
      totalPages: Math.ceil(countRes.rows[0].total / lim),
    });
  } catch (err) {
    console.error('Error en admin listProducts:', err);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
};

// ============================================================
// PATCH /admin/products/:id — Cambiar status (paused, sold, deleted)
// Body: { status }
// ============================================================
const updateProductStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowed = ['active', 'paused', 'sold', 'deleted'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status debe ser uno de: ${allowed.join(', ')}` });
  }

  try {
    const result = await db.query(
      `UPDATE products
          SET status = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, title, status`,
      [status, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ message: 'Producto actualizado', product: result.rows[0] });
  } catch (err) {
    console.error('Error en admin updateProductStatus:', err);
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
};

// ============================================================
// GET /admin/orders — Listar todas las órdenes
// ============================================================
const listOrders = async (req, res) => {
  const { status, payment_status, page = 1, limit = 20 } = req.query;
  const lim    = Math.min(parseInt(limit, 10) || 20, 100);
  const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * lim;

  const params = [];
  const conditions = [];
  if (status) { params.push(status); conditions.push(`o.status = $${params.length}`); }
  if (payment_status) { params.push(payment_status); conditions.push(`o.payment_status = $${params.length}`); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(lim, offset);

  try {
    const result = await db.query(
      `SELECT o.id, o.status, o.payment_status, o.total_price, o.currency,
              o.commission_amount, o.shipping_method, o.created_at, o.paid_at,
              p.title  AS product_title,
              ub.name  AS buyer_name,  ub.email AS buyer_email,
              us.name  AS seller_name, us.email AS seller_email
         FROM orders o
         LEFT JOIN products p ON p.id = o.product_id
         LEFT JOIN users ub ON ub.id = o.buyer_id
         LEFT JOIN users us ON us.id = o.seller_id
         ${where}
        ORDER BY o.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, -2);
    const countRes = await db.query(
      `SELECT COUNT(*)::int AS total FROM orders o ${where}`,
      countParams
    );

    res.json({
      data:       result.rows,
      total:      countRes.rows[0].total,
      page:       parseInt(page, 10) || 1,
      limit:      lim,
      totalPages: Math.ceil(countRes.rows[0].total / lim),
    });
  } catch (err) {
    console.error('Error en admin listOrders:', err);
    res.status(500).json({ error: 'Error al obtener órdenes' });
  }
};

// ============================================================
// GET /admin/reviews — Todas las reviews + posibilidad de borrar
// ============================================================
const listReviews = async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const lim    = Math.min(parseInt(limit, 10) || 20, 100);
  const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * lim;

  try {
    const result = await db.query(
      `SELECT r.id, r.rating, r.title, r.body, r.item_type, r.item_id, r.created_at,
              u.id   AS reviewer_id,
              u.name AS reviewer_name,
              u.email AS reviewer_email,
              COALESCE(p.title, s.title) AS item_title
         FROM reviews r
         LEFT JOIN users u    ON u.id = r.reviewer_id
         LEFT JOIN products p ON r.item_type = 'product' AND r.item_id = p.id
         LEFT JOIN services s ON r.item_type = 'service' AND r.item_id = s.id
        ORDER BY r.created_at DESC
        LIMIT $1 OFFSET $2`,
      [lim, offset]
    );

    const countRes = await db.query('SELECT COUNT(*)::int AS total FROM reviews');

    res.json({
      data:       result.rows,
      total:      countRes.rows[0].total,
      page:       parseInt(page, 10) || 1,
      limit:      lim,
      totalPages: Math.ceil(countRes.rows[0].total / lim),
    });
  } catch (err) {
    console.error('Error en admin listReviews:', err);
    res.status(500).json({ error: 'Error al obtener reseñas' });
  }
};

// ============================================================
// DELETE /admin/reviews/:id — Eliminar reseña abusiva
// ============================================================
const deleteReview = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      'DELETE FROM reviews WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Reseña no encontrada' });
    res.json({ message: 'Reseña eliminada' });
  } catch (err) {
    console.error('Error en admin deleteReview:', err);
    res.status(500).json({ error: 'Error al eliminar reseña' });
  }
};

module.exports = {
  getStats,
  getStatsTimeseries,
  listUsers,
  updateUser,
  listProducts,
  updateProductStatus,
  listOrders,
  listReviews,
  deleteReview,
};
