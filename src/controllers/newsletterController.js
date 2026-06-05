/**
 * Newsletter — endpoint público para suscribir emails desde el footer.
 *
 * No requiere auth. Rate-limited (10 por IP cada 15min).
 * Persiste en newsletter_subscribers — si la tabla no existe (migration 011
 * no aplicada), responde 200 igual y loggea warning. Esto previene que el
 * deploy del backend rompa el form mientras se corre la migration.
 *
 * UNIQUE constraint en email: si ya está suscripto, lo tratamos como éxito
 * silencioso (no le decimos al user "ya estabas suscripto" — info inútil).
 */

const db = require('../config/database');

function isValidEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

async function subscribe(req, res) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const source = String(req.body?.source || 'footer').slice(0, 50);

    if (!isValidEmail(email) || email.length > 150) {
      return res.status(400).json({ ok: false, error: 'Email inválido' });
    }

    try {
      await db.query(
        `INSERT INTO newsletter_subscribers (email, source, source_ip, user_agent)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL`,
        [
          email, source,
          req.ip || null,
          (req.get && req.get('user-agent'))?.slice(0, 500) || null,
        ]
      );
    } catch (err) {
      if (err.code === '42P01') {
        // Tabla no existe — la migration 011 no se aplicó. Loggeamos y
        // respondemos OK igual para no romper el form.
        console.warn('[newsletter] tabla newsletter_subscribers no existe (correr migration 011)');
      } else {
        throw err;
      }
    }

    res.json({ ok: true, message: 'Suscripción confirmada' });
  } catch (err) {
    console.error('[newsletter] Error:', err);
    res.status(500).json({ ok: false, error: 'Error al procesar la suscripción' });
  }
}

// Admin: listar suscriptores activos
async function listSubscribers(req, res) {
  const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const offset = (page - 1) * limit;

  try {
    const countRes = await db.query(
      `SELECT count(*)::int AS total FROM newsletter_subscribers WHERE unsubscribed_at IS NULL`
    );
    const dataRes = await db.query(
      `SELECT id, email, source, created_at
         FROM newsletter_subscribers
         WHERE unsubscribed_at IS NULL
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({
      data: dataRes.rows,
      page, limit,
      total: countRes.rows[0].total,
      pages: Math.ceil(countRes.rows[0].total / limit),
    });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Tabla newsletter_subscribers no existe. Correr migration 011.' });
    }
    console.error('[admin/newsletter] Error:', err);
    res.status(500).json({ error: 'Error al listar suscriptores' });
  }
}

module.exports = { subscribe, listSubscribers };
