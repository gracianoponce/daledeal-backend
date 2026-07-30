/**
 * Verificación de prestadores (insignias de confianza) — MVP manual.
 *
 * El prestador SOLICITA una verificación (identidad o profesional); el equipo
 * la revisa por fuera (videollamada / chequeo de matrícula) y la aprueba o
 * rechaza desde el admin. Al aprobar, se prende la insignia en el usuario.
 * NO se almacenan documentos ni datos biométricos (ver migration 013).
 *
 * Tolerante a que la migration 013 no esté aplicada (42P01/42703 → respuesta
 * suave), para que el deploy del código no rompa nada si llega antes.
 */
const db = require('../config/database');

// Columna de users que "prende" cada tipo al aprobarse. background = antecedentes
// penales validados contra el RNR por su código oficial (sin guardar documentos).
const TYPE_COLS = {
  identity:     'verified_identity',
  professional: 'verified_professional',
  background:   'verified_background',
};
const TYPES = Object.keys(TYPE_COLS);
const clip = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// 23514 = check constraint (migration 014 sin aplicar y llega type 'background')
const migPending = (err) => err.code === '42P01' || err.code === '42703' || err.code === '23514';

// POST /verifications  (auth) — el prestador solicita una verificación
async function requestVerification(req, res) {
  try {
    const type = clip(req.body?.type, 20).toLowerCase();
    const contactNote = clip(req.body?.contact_note, 500);
    if (!TYPES.includes(type)) {
      return res.status(400).json({ error: "Tipo inválido. Usá 'identity', 'professional' o 'background'." });
    }
    // Columna derivada del mapa fijo (no del input) → sin riesgo de inyección.
    const col = TYPE_COLS[type];
    const u = await db.query(`SELECT ${col} AS v FROM users WHERE id = $1`, [req.user.id]);
    if (u.rows[0]?.v) {
      return res.status(409).json({ error: 'Ya tenés esta verificación aprobada.' });
    }
    const r = await db.query(
      `INSERT INTO verification_requests (user_id, type, contact_note)
       VALUES ($1, $2, $3)
       RETURNING id, type, status, created_at`,
      [req.user.id, type, contactNote || null]
    );
    return res.status(201).json({ ok: true, request: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') { // ya hay un pedido pendiente de ese tipo (índice único)
      return res.status(409).json({ error: 'Ya tenés un pedido pendiente de ese tipo.' });
    }
    if (migPending(err)) {
      return res.status(503).json({ error: 'La verificación todavía no está disponible.' });
    }
    console.error('[verifications] request:', err.message);
    return res.status(500).json({ error: 'No pudimos procesar el pedido.' });
  }
}

// GET /verifications/me  (auth) — estado propio + historial de pedidos
async function getMyVerification(req, res) {
  try {
    const u = await db.query(
      `SELECT verified_identity, verified_professional, verified_background, verified_at
         FROM users WHERE id = $1`,
      [req.user.id]
    );
    const reqs = await db.query(
      `SELECT id, type, status, admin_note, created_at, reviewed_at
         FROM verification_requests
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [req.user.id]
    );
    return res.json({ ...(u.rows[0] || {}), requests: reqs.rows });
  } catch (err) {
    if (migPending(err)) {
      return res.json({ verified_identity: false, verified_professional: false, verified_background: false, verified_at: null, requests: [] });
    }
    console.error('[verifications] me:', err.message);
    return res.status(500).json({ error: 'Error al leer tu verificación.' });
  }
}

// GET /admin/verifications?status=pending  (admin) — la cola de revisión
async function listVerifications(req, res) {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status)
      ? req.query.status : 'pending';
    const r = await db.query(
      `SELECT v.id, v.type, v.status, v.contact_note, v.admin_note, v.created_at, v.reviewed_at,
              u.id AS user_id, u.name AS user_name, u.email AS user_email, u.location AS user_location
         FROM verification_requests v
         JOIN users u ON u.id = v.user_id
        WHERE v.status = $1
        ORDER BY v.created_at ASC`,
      [status]
    );
    return res.json({ status, total: r.rows.length, requests: r.rows });
  } catch (err) {
    if (migPending(err)) return res.json({ status: 'pending', total: 0, requests: [] });
    console.error('[verifications] list:', err.message);
    return res.status(500).json({ error: 'Error al listar verificaciones.' });
  }
}

// POST /admin/verifications/:id/review  (admin) — aprobar/rechazar
async function reviewVerification(req, res) {
  const client = await db.pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const decision = clip(req.body?.decision, 10).toLowerCase();
    const adminNote = clip(req.body?.admin_note, 500);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido.' });
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ error: "Decisión inválida. Usá 'approve' o 'reject'." });
    }

    await client.query('BEGIN');
    const cur = await client.query(
      'SELECT id, user_id, type, status FROM verification_requests WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (cur.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }
    if (cur.rows[0].status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Este pedido ya fue revisado.' });
    }

    const newStatus = decision === 'approve' ? 'approved' : 'rejected';
    await client.query(
      `UPDATE verification_requests
          SET status = $1, admin_note = $2, reviewed_by = $3, reviewed_at = NOW()
        WHERE id = $4`,
      [newStatus, adminNote || null, req.user.id, id]
    );
    if (decision === 'approve') {
      const col = TYPE_COLS[cur.rows[0].type] || 'verified_identity';
      await client.query(
        `UPDATE users SET ${col} = true, verified_at = NOW() WHERE id = $1`,
        [cur.rows[0].user_id]
      );
    }
    await client.query('COMMIT');
    return res.json({ ok: true, id, status: newStatus });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[verifications] review:', err.message);
    return res.status(500).json({ error: 'No pudimos procesar la revisión.' });
  } finally {
    client.release();
  }
}

module.exports = {
  requestVerification,
  getMyVerification,
  listVerifications,
  reviewVerification,
};
