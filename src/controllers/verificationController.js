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

// Documentos que pide cada tipo. Los archivos se guardan solo hasta la revisión
// (migración 018): al aprobar o rechazar se borran.
const DOC_KINDS = { identity: ['dni_front', 'dni_back', 'selfie'], professional: ['title'] };
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE = 2 * 1024 * 1024;
const MAX_PDF   = 4 * 1024 * 1024;
const DOC_LABEL = { dni_front: 'el DNI de frente', dni_back: 'el DNI de dorso', selfie: 'la foto de tu cara', title: 'el título' };

/** data URL → { mime, buf } validado por tipo y tamaño. Lanza Error con mensaje para el usuario. */
function parseDataUrl(kind, dataUrl) {
  const m = /^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ''));
  if (!m) throw new Error(`No pudimos leer ${DOC_LABEL[kind]}. Volvé a elegir el archivo.`);
  const mime = m[1].toLowerCase();
  const isPdf = mime === 'application/pdf';
  if (isPdf && kind !== 'title') throw new Error(`${DOC_LABEL[kind]} tiene que ser una foto (JPG, PNG o WEBP).`);
  if (!isPdf && !IMAGE_MIMES.includes(mime)) throw new Error(`Formato no soportado para ${DOC_LABEL[kind]}: usá JPG, PNG, WEBP${kind === 'title' ? ' o PDF' : ''}.`);
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw new Error(`${DOC_LABEL[kind]} llegó vacío.`);
  if (buf.length > (isPdf ? MAX_PDF : MAX_IMAGE)) throw new Error(`${DOC_LABEL[kind]} pesa demasiado (máximo ${isPdf ? '4' : '2'} MB).`);
  return { mime, buf };
}

// POST /verifications/documents  (auth) — DNI frente/dorso + cara (+ título) →
// pedidos pendientes con sus archivos, en una transacción.
async function uploadDocuments(req, res) {
  if (req.body?.consent !== true) {
    return res.status(400).json({ error: 'Tenés que aceptar el uso de los documentos para verificar tu identidad.' });
  }
  const docs = {};
  try {
    for (const kind of DOC_KINDS.identity) {
      if (!req.body?.[kind]) return res.status(400).json({ error: `Falta ${DOC_LABEL[kind]}.` });
      docs[kind] = parseDataUrl(kind, req.body[kind]);
    }
    if (req.body?.title) docs.title = parseDataUrl('title', req.body.title);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const types = ['identity', ...(docs.title ? ['professional'] : [])];
  const client = await db.pool.connect();
  try {
    const u = await db.query('SELECT verified_identity, verified_professional FROM users WHERE id = $1', [req.user.id]);
    const flags = u.rows[0] || {};
    if (flags.verified_identity && (!docs.title || flags.verified_professional)) {
      return res.status(409).json({ error: 'Tu cuenta ya está verificada.' });
    }
    await client.query('BEGIN');
    const created = [];
    for (const type of types) {
      if (flags[TYPE_COLS[type]]) continue; // ya tiene esa insignia: no duplicar
      const r = await client.query(
        `INSERT INTO verification_requests (user_id, type, contact_note)
         VALUES ($1, $2, $3)
         RETURNING id, type, status`,
        [req.user.id, type, 'Documentos adjuntos']
      );
      created.push(r.rows[0]);
      for (const kind of DOC_KINDS[type]) {
        const d = docs[kind];
        await client.query(
          `INSERT INTO verification_documents (request_id, user_id, kind, mime, bytes, size)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [r.rows[0].id, req.user.id, kind, d.mime, d.buf, d.buf.length]
        );
      }
    }
    await client.query('COMMIT');
    return res.status(201).json({ ok: true, requests: created });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') { // índice único: ya hay un pedido pendiente de ese tipo
      return res.status(409).json({ error: 'Ya tenés una verificación en revisión. Te avisamos por mail cuando esté.' });
    }
    if (migPending(err)) {
      return res.status(503).json({ error: 'La verificación con documentos todavía no está disponible.' });
    }
    console.error('[verifications] documents:', err.message);
    return res.status(500).json({ error: 'No pudimos guardar los documentos. Probá de nuevo.' });
  } finally {
    client.release();
  }
}

/** Documentos (sin los bytes) de una lista de pedidos, agrupados por request_id.
 *  Si la migración 018 no está aplicada, devuelve vacío. */
async function documentsFor(requestRows) {
  const ids = requestRows.map(r => r.id);
  if (!ids.length) return requestRows.map(r => ({ ...r, documents: [] }));
  let docs = [];
  try {
    docs = (await db.query(
      `SELECT id, request_id, kind, mime, size FROM verification_documents WHERE request_id = ANY($1::int[]) ORDER BY id`,
      [ids]
    )).rows;
  } catch (err) {
    if (!migPending(err)) throw err;
  }
  return requestRows.map(r => ({
    ...r,
    documents: docs.filter(d => d.request_id === r.id).map(({ id, kind, mime, size }) => ({ id, kind, mime, size })),
  }));
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
    return res.json({ ...(u.rows[0] || {}), requests: await documentsFor(reqs.rows) });
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
    const sql = (withDocCols) => `
      SELECT v.id, v.type, v.status, v.contact_note, v.admin_note, v.created_at, v.reviewed_at,
             ${withDocCols ? 'v.document_name, v.document_number, v.credential,' : ''}
             u.id AS user_id, u.name AS user_name, u.email AS user_email, u.location AS user_location
        FROM verification_requests v
        JOIN users u ON u.id = v.user_id
       WHERE v.status = $1
       ORDER BY v.created_at ASC`;
    let r;
    try {
      r = await db.query(sql(true), [status]);
    } catch (err) {
      if (err.code !== '42703') throw err; // migración 018 sin aplicar: sin las columnas nuevas
      r = await db.query(sql(false), [status]);
    }
    const requests = await documentsFor(r.rows);
    return res.json({ status, total: requests.length, requests });
  } catch (err) {
    if (migPending(err)) return res.json({ status: 'pending', total: 0, requests: [] });
    console.error('[verifications] list:', err.message);
    return res.status(500).json({ error: 'Error al listar verificaciones.' });
  }
}

// GET /admin/verification-documents/:id  (admin) — el archivo, nunca por URL pública
async function getDocument(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido.' });
  try {
    const r = await db.query('SELECT mime, bytes FROM verification_documents WHERE id = $1', [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'El documento no existe o ya fue eliminado.' });
    res.set({
      'Content-Type': r.rows[0].mime,
      'Cache-Control': 'no-store',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.send(r.rows[0].bytes);
  } catch (err) {
    if (migPending(err)) return res.status(404).json({ error: 'El documento no existe.' });
    console.error('[verifications] document:', err.message);
    return res.status(500).json({ error: 'No pudimos leer el documento.' });
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
  uploadDocuments,
  getMyVerification,
  listVerifications,
  reviewVerification,
  getDocument,
};
