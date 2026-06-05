/**
 * Contact form controller.
 *
 * Maneja envíos del formulario de contacto en HTML/contacto.html.
 * No requiere autenticación (cualquier visitante puede contactarnos).
 *
 * Envía 2 emails:
 *  1. Al equipo (CONTACT_INBOX o contacto@daledeal.com) con todos los datos.
 *  2. Al usuario confirmando la recepción ("te respondemos en 24hs").
 *
 * Tipos especiales: `tipo=empresa` viene del link "¿Sos una empresa?"
 * en signup.html — lo distinguimos en el asunto para priorizarlo
 * (las empresas son leads B2B de mayor valor).
 */

const { sendEmail } = require('../services/email');
const db = require('../config/database');

const CONTACT_INBOX = process.env.CONTACT_INBOX || 'contacto@daledeal.com';

/**
 * Guarda un lead B2B en la tabla company_leads (si existe — la migration 010
 * la crea). Si la tabla no existe (e.g. migration no aplicada), loggea warning
 * y devuelve null silenciosamente — el flujo de email sigue funcionando.
 *
 * Esto hace el endpoint /contact retrocompatible: el backend deploya antes
 * que la migration sin romper nada.
 */
async function saveCompanyLead(payload, req) {
  try {
    const r = await db.query(
      `INSERT INTO company_leads
         (nombre, apellido, email, telefono, asunto, mensaje, pedido_id, source_ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        payload.nombre, payload.apellido, payload.email,
        payload.telefono || null, payload.asunto || null,
        payload.mensaje, payload.pedidoId || null,
        req.ip || null,
        (req.get && req.get('user-agent')) || null,
      ]
    );
    return r.rows[0].id;
  } catch (err) {
    // 42P01 = undefined_table — la migration 010 no se aplicó todavía.
    // No fallar — el ack al user y el email al equipo siguen funcionando.
    if (err.code === '42P01') {
      console.warn('[contact] tabla company_leads no existe, skip persistencia (correr migration 010)');
      return null;
    }
    console.error('[contact] Error al persistir lead:', err.message);
    return null;
  }
}

// Limitamos longitud para evitar spam masivo / DoS de la API de Resend
const MAX_LEN = {
  nombre:  100,
  apellido: 100,
  email:    150,
  telefono: 50,
  asunto:   150,
  pedidoId: 50,
  mensaje:  4000,
  tipo:     30,
};

function clip(v, max) {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return t.length > max ? t.slice(0, max) : t;
}

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function submitContact(req, res) {
  try {
    const body = req.body || {};
    const nombre   = clip(body.nombre,   MAX_LEN.nombre);
    const apellido = clip(body.apellido, MAX_LEN.apellido);
    const email    = clip(body.email,    MAX_LEN.email);
    const telefono = clip(body.telefono, MAX_LEN.telefono);
    const asunto   = clip(body.asunto,   MAX_LEN.asunto);
    const pedidoId = clip(body.pedidoId, MAX_LEN.pedidoId);
    const mensaje  = clip(body.mensaje,  MAX_LEN.mensaje);
    const tipo     = clip(body.tipo,     MAX_LEN.tipo).toLowerCase();

    // ── Validación ─────────────────────────────────────────────
    if (!nombre || !apellido || !email || !asunto || !mensaje) {
      return res.status(400).json({
        ok: false,
        error: 'Faltan campos obligatorios: nombre, apellido, email, asunto, mensaje.',
      });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: 'Email inválido.' });
    }
    if (mensaje.length < 10) {
      return res.status(400).json({ ok: false, error: 'El mensaje es muy corto (mínimo 10 caracteres).' });
    }

    const fullName = `${nombre} ${apellido}`.trim();
    const isEmpresa = tipo === 'empresa';
    const subjectPrefix = isEmpresa ? '🏢 [B2B] ' : '📩 ';

    // Si es lead B2B, persistir en company_leads (no-op si la tabla no existe).
    // Lo hacemos ANTES del email para que el admin tenga el lead en el
    // dashboard aunque el envío de email falle.
    let leadId = null;
    if (isEmpresa) {
      leadId = await saveCompanyLead({
        nombre, apellido, email, telefono, asunto, mensaje, pedidoId
      }, req);
      if (leadId) console.log(`[contact] B2B lead #${leadId} guardado (${email})`);
    }

    // ── Email al equipo ────────────────────────────────────────
    const teamInner = `
      <h2 style="margin:0 0 16px;font-size:20px;color:#1f2937;">
        ${isEmpresa ? 'Nueva consulta empresarial' : 'Nueva consulta de contacto'}
      </h2>

      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f9fafb;border-radius:8px;padding:16px;margin:0 0 20px;border:1px solid #e5e7eb;font-size:14px;">
        <tr><td style="padding:4px 0;color:#6b7280;width:120px;">Nombre:</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(fullName)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Email:</td><td style="padding:4px 0;"><a href="mailto:${escapeHtml(email)}" style="color:#d63031;">${escapeHtml(email)}</a></td></tr>
        ${telefono ? `<tr><td style="padding:4px 0;color:#6b7280;">Teléfono:</td><td style="padding:4px 0;">${escapeHtml(telefono)}</td></tr>` : ''}
        <tr><td style="padding:4px 0;color:#6b7280;">Asunto:</td><td style="padding:4px 0;">${escapeHtml(asunto)}</td></tr>
        ${pedidoId ? `<tr><td style="padding:4px 0;color:#6b7280;">Pedido:</td><td style="padding:4px 0;">${escapeHtml(pedidoId)}</td></tr>` : ''}
        ${isEmpresa ? '<tr><td style="padding:4px 0;color:#6b7280;">Tipo:</td><td style="padding:4px 0;font-weight:600;color:#d63031;">🏢 EMPRESA (B2B)</td></tr>' : ''}
      </table>

      <h3 style="font-size:15px;margin:16px 0 8px;">Mensaje:</h3>
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:14px;white-space:pre-wrap;font-size:14px;line-height:1.6;">${escapeHtml(mensaje)}</div>

      <p style="font-size:12px;color:#9ca3af;margin-top:20px;">
        Para responder, simplemente respondé este email — el reply-to ya está configurado al usuario.
      </p>
    `;

    const teamEmail = await sendEmail({
      to:      CONTACT_INBOX,
      subject: `${subjectPrefix}${asunto} — ${fullName}`,
      replyTo: email,  // permite responder directo al usuario desde Gmail
      html:    `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;padding:24px;max-width:600px;margin:0 auto;">${teamInner}</body></html>`,
      text:    `Nueva consulta de contacto\n\nDe: ${fullName} <${email}>${telefono ? '\nTel: ' + telefono : ''}\nAsunto: ${asunto}${pedidoId ? '\nPedido: ' + pedidoId : ''}${isEmpresa ? '\nTipo: EMPRESA (B2B)' : ''}\n\n${mensaje}`,
    });

    if (!teamEmail.ok) {
      console.error('[contact] No se pudo enviar email al equipo:', teamEmail.error);
      // Seguimos igual — el ack al usuario es lo crítico
    }

    // ── Email de confirmación al usuario ────────────────────────
    const userHtml = `
      <!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,sans-serif;color:#1f2937;">
        <table role="presentation" width="100%" style="background:#f5f5f5;padding:24px 12px;">
          <tr><td align="center">
            <table role="presentation" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">
              <tr><td style="background:linear-gradient(135deg,#ff8000 0%,#d63031 100%);padding:24px;text-align:center;">
                <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-.5px;">DALE DEAL</span>
              </td></tr>
              <tr><td style="padding:28px 32px;line-height:1.55;font-size:15px;">
                <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;">Recibimos tu mensaje ✅</h2>
                <p>Hola ${escapeHtml(nombre)},</p>
                <p>Gracias por escribirnos. Tu consulta sobre <strong>${escapeHtml(asunto)}</strong> ya está en nuestro inbox y un miembro del equipo te va a responder en <strong>menos de 24 horas hábiles</strong>.</p>
                <p>Si es urgente, también podés escribirnos por WhatsApp al <strong>+54 9 11 3798-5881</strong>.</p>
                <p style="font-size:13px;color:#6b7280;margin-top:24px;">— Equipo Dale Deal</p>
              </td></tr>
              <tr><td style="background:#f9fafb;padding:18px 32px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">
                <a href="https://daledeal.com.ar" style="color:#d63031;text-decoration:none;">daledeal.com.ar</a> ·
                <a href="https://daledeal.com.ar/HTML/contacto.html" style="color:#d63031;text-decoration:none;">Contacto</a>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body></html>`;

    await sendEmail({
      to:      email,
      subject: 'Recibimos tu consulta — Dale Deal',
      html:    userHtml,
      text:    `Hola ${nombre},\n\nRecibimos tu consulta sobre "${asunto}". Te respondemos en menos de 24hs hábiles.\n\n— Equipo Dale Deal`,
    });

    return res.json({
      ok: true,
      message: 'Mensaje enviado. Te respondemos en menos de 24hs hábiles.',
    });
  } catch (err) {
    console.error('[contact] Error:', err);
    return res.status(500).json({
      ok: false,
      error: 'No pudimos procesar tu mensaje. Probá de nuevo en unos minutos.',
    });
  }
}

// ============================================================
// ADMIN — gestión de leads B2B
// ============================================================

/**
 * GET /admin/leads
 * Lista todos los leads B2B con paginación y filtro por status.
 * Query params: ?page=1&limit=20&status=new|contacted|qualified|customer|lost
 */
async function listLeads(req, res) {
  const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const status = req.query.status;

  const VALID_STATUS = ['new', 'contacted', 'qualified', 'customer', 'lost'];
  const where = status && VALID_STATUS.includes(status) ? 'WHERE status = $1' : '';
  const params = status && VALID_STATUS.includes(status) ? [status] : [];

  try {
    const countRes = await db.query(`SELECT count(*)::int AS total FROM company_leads ${where}`, params);
    const dataRes = await db.query(
      `SELECT id, nombre, apellido, email, telefono, asunto, mensaje, pedido_id,
              status, notes, created_at, updated_at
         FROM company_leads
         ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({
      data: dataRes.rows,
      page,
      limit,
      total: countRes.rows[0].total,
      pages: Math.ceil(countRes.rows[0].total / limit),
    });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({
        error: 'Tabla company_leads no existe. Correr migration 010_company_leads.sql.',
      });
    }
    console.error('[admin/leads] Error:', err);
    res.status(500).json({ error: 'Error al listar leads' });
  }
}

/**
 * PATCH /admin/leads/:id
 * Actualiza status / notes de un lead. Body: { status?, notes? }
 */
async function updateLead(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'id inválido' });
  }

  const { status, notes } = req.body || {};
  const VALID_STATUS = ['new', 'contacted', 'qualified', 'customer', 'lost'];
  if (status !== undefined && !VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: `status debe ser uno de: ${VALID_STATUS.join(', ')}` });
  }
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > 5000)) {
    return res.status(400).json({ error: 'notes inválido (string, max 5000)' });
  }

  if (status === undefined && notes === undefined) {
    return res.status(400).json({ error: 'Debe especificar status o notes' });
  }

  try {
    const r = await db.query(
      `UPDATE company_leads
          SET status = COALESCE($1, status),
              notes  = COALESCE($2, notes)
        WHERE id = $3
       RETURNING id, status, notes, updated_at`,
      [status || null, notes || null, id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Lead no encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Tabla company_leads no existe' });
    }
    console.error('[admin/leads PATCH] Error:', err);
    res.status(500).json({ error: 'Error al actualizar lead' });
  }
}

module.exports = { submitContact, listLeads, updateLead };
