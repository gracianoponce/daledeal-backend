const db = require('../config/database');

const VALID_CATEGORIES = [
  'technical', 'payment', 'content', 'fraud',
  'account', 'shipping', 'other',
  // Compliance Argentina (Resolución 424/2020 SCI):
  'arrepentimiento',
];

// ============================================================
// POST /reports
// Crea un reporte. Funciona logueado o anónimo.
// Body: { category, subject?, body, url?, reporter_email? }
// ============================================================
const createReport = async (req, res) => {
  const { category, subject, body, url, reporter_email } = req.body;

  if (!category || !body) {
    return res.status(400).json({ error: 'category y body son obligatorios' });
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({
      error: 'Categoría inválida',
      allowed: VALID_CATEGORIES,
    });
  }
  if (String(body).trim().length < 10) {
    return res.status(400).json({ error: 'Contale más detalle (mínimo 10 caracteres)' });
  }
  if (String(body).length > 5000) {
    return res.status(400).json({ error: 'El reporte es demasiado largo (máximo 5000 caracteres)' });
  }

  // Resolver el email del reportador: usuario autenticado > el que vino en el body
  let userId = null;
  let email  = (reporter_email || '').trim() || null;
  if (req.user && req.user.id) {
    userId = req.user.id;
    if (req.user.email) email = req.user.email;
  }

  try {
    const result = await db.query(
      `INSERT INTO problem_reports
         (user_id, reporter_email, category, subject, body, url, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, category, status, created_at`,
      [
        userId,
        email,
        category,
        (subject || '').toString().slice(0, 200) || null,
        body.toString().trim(),
        (url || '').toString().slice(0, 500) || null,
        (req.headers['user-agent'] || '').toString().slice(0, 500) || null,
        (req.ip || '').toString().slice(0, 64) || null,
      ]
    );

    res.status(201).json({
      message: 'Recibimos tu reporte. Te contactamos a la brevedad si necesitamos más info.',
      report:  result.rows[0],
    });
  } catch (err) {
    console.error('Error en createReport:', err);
    res.status(500).json({ error: 'Error al enviar el reporte' });
  }
};

// ============================================================
// ADMIN: GET /admin/reports
// Listar reportes con filtros + paginación
// ============================================================
const listReports = async (req, res) => {
  const { status = '', category = '', page = 1, limit = 20 } = req.query;
  const lim    = Math.min(parseInt(limit, 10) || 20, 100);
  const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * lim;

  const params = [];
  const conditions = [];
  if (status)   { params.push(status);   conditions.push(`r.status = $${params.length}`); }
  if (category) { params.push(category); conditions.push(`r.category = $${params.length}`); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(lim, offset);

  try {
    const result = await db.query(
      `SELECT r.id, r.category, r.subject, r.body, r.url, r.status,
              r.admin_notes, r.created_at, r.updated_at,
              r.reporter_email,
              u.id   AS user_id,
              u.name AS user_name
         FROM problem_reports r
         LEFT JOIN users u ON u.id = r.user_id
         ${where}
        ORDER BY r.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, -2);
    const countRes = await db.query(
      `SELECT COUNT(*)::int AS total FROM problem_reports r ${where}`,
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
    console.error('Error en listReports:', err);
    res.status(500).json({ error: 'Error al obtener reportes' });
  }
};

// ============================================================
// ADMIN: PATCH /admin/reports/:id
// Marcar como in_review / resolved / dismissed + notas internas
// ============================================================
const updateReport = async (req, res) => {
  const { id } = req.params;
  const { status, admin_notes } = req.body;

  const validStatuses = ['open', 'in_review', 'resolved', 'dismissed'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  try {
    const result = await db.query(
      `UPDATE problem_reports SET
         status      = COALESCE($1, status),
         admin_notes = COALESCE($2, admin_notes),
         resolved_at = CASE
                         WHEN $1 IN ('resolved', 'dismissed') AND resolved_at IS NULL THEN NOW()
                         ELSE resolved_at
                       END,
         updated_at  = NOW()
       WHERE id = $3
       RETURNING id, status, resolved_at`,
      [status || null, admin_notes || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reporte no encontrado' });
    }

    res.json({ message: 'Reporte actualizado', report: result.rows[0] });
  } catch (err) {
    console.error('Error en updateReport:', err);
    res.status(500).json({ error: 'Error al actualizar reporte' });
  }
};

module.exports = { createReport, listReports, updateReport };
