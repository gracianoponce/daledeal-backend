/**
 * Datos de cobro del vendedor (migration 017).
 *
 *   GET /users/me/payout-account   → los datos propios (solo el dueño)
 *   PUT /users/me/payout-account   { account, holder } → guardar / cambiar
 *
 * Al cambiarlos sale un mail de aviso al dueño: si alguien entra a una cuenta
 * ajena, lo primero que intenta es desviar los cobros.
 * Tolerante a la migration pendiente (42703): GET → available:false, PUT → 503.
 */
const db = require('../config/database');
const { normalizePayoutAccount, normalizeHolder, describePayoutAccount } = require('../services/payoutAccount');
const { sendEmail, payoutAccountChangedTemplate } = require('../services/email');

const migPending = err => !!err && (err.code === '42703' || err.code === '42P01');

const toResponse = (row, extra = {}) => {
  const d = describePayoutAccount(row.payout_account);
  return {
    available:  true,
    account:    row.payout_account || null,
    kind:       d ? d.kind : null,
    label:      d ? d.label : null,
    holder:     row.payout_holder || null,
    updated_at: row.payout_updated_at || null,
    ...extra,
  };
};

async function getMyPayoutAccount(req, res) {
  try {
    const r = await db.query(
      'SELECT payout_account, payout_holder, payout_updated_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    return res.json(toResponse(r.rows[0]));
  } catch (err) {
    if (migPending(err)) {
      return res.json({ available: false, account: null, kind: null, label: null, holder: null, updated_at: null });
    }
    console.error('[payout-account] get:', err.message);
    return res.status(500).json({ error: 'Error al obtener tus datos de cobro' });
  }
}

async function updateMyPayoutAccount(req, res) {
  const account = normalizePayoutAccount(req.body?.account);
  if (!account.ok) return res.status(400).json({ error: account.error, field: 'account' });
  const holder = normalizeHolder(req.body?.holder);
  if (!holder.ok) return res.status(400).json({ error: holder.error, field: 'holder' });

  try {
    const r = await db.query(
      `UPDATE users
          SET payout_account = $1, payout_holder = $2, payout_updated_at = NOW(), updated_at = NOW()
        WHERE id = $3
        RETURNING payout_account, payout_holder, payout_updated_at, email, name`,
      [account.value, holder.value, req.user.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    const row = r.rows[0];

    if (row.email) {
      const tpl = payoutAccountChangedTemplate({
        name:         row.name,
        accountLabel: describePayoutAccount(row.payout_account).label,
        holder:       row.payout_holder,
      });
      sendEmail({ to: row.email, subject: tpl.subject, html: tpl.html, text: tpl.text })
        .catch(e => console.error('[email] payout-account notify failed:', e.message));
    }

    return res.json(toResponse(row, { message: 'Datos de cobro guardados' }));
  } catch (err) {
    if (migPending(err)) {
      return res.status(503).json({ error: 'Los datos de cobro todavía no están disponibles. Probá en unos minutos.' });
    }
    console.error('[payout-account] update:', err.message);
    return res.status(500).json({ error: 'No pudimos guardar tus datos de cobro' });
  }
}

module.exports = { getMyPayoutAccount, updateMyPayoutAccount };
