/**
 * Servicio de email para Dale Deal.
 *
 * Provider activo: Resend (https://resend.com — free tier 100 emails/día).
 *
 * Si RESEND_API_KEY no está configurado, hace fallback a console.log
 * (útil en desarrollo). Cualquier endpoint que use sendEmail() sigue
 * funcionando normalmente, solo que el email no sale a la red.
 *
 * Si querés cambiar de provider (Postmark, SendGrid, AWS SES), tocás
 * solo este archivo — la API pública sendEmail() se mantiene igual.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_API_URL = 'https://api.resend.com/emails';

const FROM_DEFAULT = process.env.EMAIL_FROM
  || 'Dale Deal <hola@daledeal.com.ar>';

const REPLY_TO_DEFAULT = process.env.EMAIL_REPLY_TO || null;

/**
 * Envía un email.
 * @param {object} opts
 * @param {string} opts.to            destinatario
 * @param {string} opts.subject       asunto
 * @param {string} opts.html          cuerpo HTML
 * @param {string} [opts.text]        versión plain text (fallback)
 * @param {string} [opts.from]        remitente (default Dale Deal)
 * @param {string} [opts.replyTo]     reply-to opcional
 * @returns {Promise<{ok:boolean, id?:string, error?:string, devOnly?:boolean}>}
 */
async function sendEmail({ to, subject, html, text, from, replyTo }) {
  const fromAddr    = from    || FROM_DEFAULT;
  const replyToAddr = replyTo || REPLY_TO_DEFAULT;

  if (!to || !subject || !html) {
    return { ok: false, error: 'to, subject y html son obligatorios' };
  }

  // ── Modo desarrollo / sin API key: loggear a consola ─────────────
  if (!RESEND_API_KEY) {
    console.log('\n┌─────────────────────────────────────────────────────────');
    console.log('│ 📧 EMAIL (modo dev — RESEND_API_KEY no configurado)');
    console.log('├─────────────────────────────────────────────────────────');
    console.log('│ De:      ', fromAddr);
    console.log('│ Para:    ', to);
    console.log('│ Asunto:  ', subject);
    if (replyToAddr) console.log('│ Reply-to:', replyToAddr);
    console.log('│');
    console.log('│ HTML preview:');
    console.log('│ ', (text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).substring(0, 280));
    console.log('└─────────────────────────────────────────────────────────\n');
    return { ok: true, devOnly: true };
  }

  // ── Producción: hit a Resend ─────────────────────────────────────
  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:     fromAddr,
        to:       Array.isArray(to) ? to : [to],
        subject,
        html,
        text:     text || undefined,
        reply_to: replyToAddr || undefined,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error('[email] Resend error:', res.status, data);
      return { ok: false, error: data?.message || `HTTP ${res.status}` };
    }

    return { ok: true, id: data.id };
  } catch (err) {
    console.error('[email] Network error:', err.message);
    return { ok: false, error: err.message };
  }
}

// ============================================================
// Layout base + helper de wrap.
// Mantiene los emails consistentes (logo, colores, footer).
// ============================================================
function emailWrap(innerHtml, { title = 'Dale Deal' } = {}) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f5;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#ff8000 0%,#d63031 100%);padding:24px;text-align:center;">
              <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-.5px;">DALE DEAL</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 32px;line-height:1.55;font-size:15px;">
              ${innerHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:18px 32px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">
              Recibiste este email porque tenés una cuenta en Dale Deal.<br>
              <a href="https://daledeal.com.ar" style="color:#d63031;text-decoration:none;">daledeal.com.ar</a> ·
              <a href="https://daledeal.com.ar/HTML/contacto.html" style="color:#d63031;text-decoration:none;">Contacto</a> ·
              <a href="https://www.instagram.com/daledeal.ar/" style="color:#d63031;text-decoration:none;">Instagram</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function btn(label, href) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:linear-gradient(135deg,#ff8000 0%,#d63031 100%);color:#ffffff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:8px;font-size:15px;">${escapeHtml(label)}</a>`;
}

// ============================================================
// Templates específicos
// ============================================================

function passwordResetTemplate({ name, resetUrl }) {
  const inner = `
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#1f2937;">Restablecer tu contraseña</h2>
    <p>Hola${name ? ' ' + escapeHtml(name) : ''},</p>
    <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en Dale Deal. Hacé click en el botón de abajo para elegir una nueva. Este link expira en <strong>60 minutos</strong>.</p>
    <p style="text-align:center;margin:28px 0;">${btn('Cambiar contraseña', resetUrl)}</p>
    <p style="font-size:13px;color:#6b7280;">Si no fuiste vos, podés ignorar este email — tu contraseña actual sigue vigente.</p>
    <p style="font-size:12px;color:#9ca3af;margin-top:24px;word-break:break-all;">
      Si el botón no funciona, copiá y pegá esta URL en el navegador:<br>
      <a href="${escapeHtml(resetUrl)}" style="color:#d63031;">${escapeHtml(resetUrl)}</a>
    </p>
  `;
  return {
    subject: 'Restablecé tu contraseña en Dale Deal',
    html:    emailWrap(inner, { title: 'Restablecer contraseña' }),
    text:    `Restablecé tu contraseña en Dale Deal\n\nUsá este link (válido por 60 min):\n${resetUrl}\n\nSi no fuiste vos, ignorá este email.`,
  };
}

function orderPaidBuyerTemplate({ buyerName, orderId, productTitle, total, sellerName, isPickup, trackingHint }) {
  const totalFmt = formatARS(total);
  const inner = `
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#1f2937;">¡Compra confirmada! 🎉</h2>
    <p>Hola${buyerName ? ' ' + escapeHtml(buyerName) : ''},</p>
    <p>Tu pago fue acreditado y la orden <strong>#${orderId}</strong> ya está confirmada. ${escapeHtml(sellerName || 'El vendedor')} fue notificado para que prepare tu pedido.</p>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f9fafb;border-radius:8px;padding:16px;margin:20px 0;border:1px solid #e5e7eb;">
      <tr><td style="font-size:13px;color:#6b7280;padding-bottom:6px;">Producto</td><td style="text-align:right;font-weight:600;">${escapeHtml(productTitle || '—')}</td></tr>
      <tr><td style="font-size:13px;color:#6b7280;padding-bottom:6px;">Total pagado</td><td style="text-align:right;font-weight:700;color:#d63031;">${totalFmt}</td></tr>
      <tr><td style="font-size:13px;color:#6b7280;">Modalidad</td><td style="text-align:right;">${isPickup ? 'Retiro en persona' : 'Envío a domicilio'}</td></tr>
    </table>

    <p>${isPickup
      ? 'Coordiná día y horario con el vendedor por chat dentro de Dale Deal.'
      : 'Cuando el vendedor despache tu pedido te vamos a avisar con el número de seguimiento.'}</p>
    ${trackingHint ? `<p style="font-size:13px;color:#6b7280;">${escapeHtml(trackingHint)}</p>` : ''}

    <p style="text-align:center;margin:28px 0;">${btn('Ver mis compras', 'https://daledeal.com.ar/HTML/notificaciones.html#mis-compras')}</p>
  `;
  return {
    subject: `Compra confirmada · Orden #${orderId}`,
    html:    emailWrap(inner, { title: 'Compra confirmada' }),
    text:    `Compra confirmada en Dale Deal\nOrden #${orderId}\nProducto: ${productTitle}\nTotal: ${totalFmt}\n\nEntrá a Mis compras: https://daledeal.com.ar/HTML/notificaciones.html#mis-compras`,
  };
}

function newSaleSellerTemplate({ sellerName, orderId, productTitle, buyerName, total, isPickup, shippingCity }) {
  const totalFmt = formatARS(total);
  const inner = `
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#1f2937;">¡Tenés una venta nueva! 🎊</h2>
    <p>Hola${sellerName ? ' ' + escapeHtml(sellerName) : ''},</p>
    <p><strong>${escapeHtml(buyerName || 'Un comprador')}</strong> compró <strong>${escapeHtml(productTitle || 'tu producto')}</strong> en Dale Deal y el pago ya fue acreditado.</p>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f9fafb;border-radius:8px;padding:16px;margin:20px 0;border:1px solid #e5e7eb;">
      <tr><td style="font-size:13px;color:#6b7280;padding-bottom:6px;">Orden</td><td style="text-align:right;font-weight:600;">#${orderId}</td></tr>
      <tr><td style="font-size:13px;color:#6b7280;padding-bottom:6px;">Total cobrado</td><td style="text-align:right;font-weight:700;color:#16a34a;">${totalFmt}</td></tr>
      <tr><td style="font-size:13px;color:#6b7280;">Modalidad</td><td style="text-align:right;">${isPickup ? 'Retiro en persona' : `Envío${shippingCity ? ' a ' + escapeHtml(shippingCity) : ''}`}</td></tr>
    </table>

    <p><strong>¿Qué hacer ahora?</strong></p>
    <ul style="padding-left:20px;line-height:1.7;">
      ${isPickup
        ? '<li>Coordiná con el comprador por chat para acordar fecha y hora.</li>'
        : '<li>Preparalo y despachalo en las próximas 48 hs.</li><li>Cuando tengas el número de tracking, cargalo en "Mis ventas" para notificar al comprador.</li>'}
      <li>Una vez entregado, tu pago será liberado.</li>
    </ul>

    <p style="text-align:center;margin:28px 0;">${btn('Ir a Mis ventas', 'https://daledeal.com.ar/HTML/mis-ventas.html')}</p>
  `;
  return {
    subject: `🎉 Vendiste "${productTitle || 'un producto'}" — Orden #${orderId}`,
    html:    emailWrap(inner, { title: 'Venta nueva' }),
    text:    `Venta nueva en Dale Deal\nOrden #${orderId}\nProducto: ${productTitle}\nTotal: ${totalFmt}\nComprador: ${buyerName}\n\nGestionala en: https://daledeal.com.ar/HTML/mis-ventas.html`,
  };
}

function orderShippedBuyerTemplate({ buyerName, orderId, productTitle, trackingNumber, sellerName }) {
  const inner = `
    <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#1f2937;">📦 Tu pedido fue despachado</h2>
    <p>Hola${buyerName ? ' ' + escapeHtml(buyerName) : ''},</p>
    <p>${escapeHtml(sellerName || 'El vendedor')} despachó tu orden <strong>#${orderId}</strong>: <strong>${escapeHtml(productTitle || '—')}</strong>.</p>

    ${trackingNumber ? `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f0f9ff;border-radius:8px;padding:18px;margin:20px 0;border:1px solid #bae6fd;text-align:center;">
      <tr><td style="font-size:13px;color:#0369a1;padding-bottom:6px;">Número de seguimiento</td></tr>
      <tr><td style="font-size:20px;font-weight:700;color:#0c4a6e;letter-spacing:1px;">${escapeHtml(trackingNumber)}</td></tr>
    </table>
    <p style="font-size:13px;color:#6b7280;">Usá este número en la web del courier que el vendedor utilizó (Correo Argentino, Andreani, OCA, etc.) para ver el progreso.</p>
    ` : '<p style="font-size:13px;color:#6b7280;">El vendedor todavía no cargó el número de seguimiento. Lo vas a poder ver en "Mis compras" cuando esté disponible.</p>'}

    <p style="text-align:center;margin:28px 0;">${btn('Ver mi pedido', 'https://daledeal.com.ar/HTML/notificaciones.html#mis-compras')}</p>
  `;
  return {
    subject: `📦 Tu pedido fue despachado · Orden #${orderId}`,
    html:    emailWrap(inner, { title: 'Pedido despachado' }),
    text:    `Tu pedido #${orderId} fue despachado.\n${trackingNumber ? 'Tracking: ' + trackingNumber + '\n' : ''}\nVer detalles: https://daledeal.com.ar/HTML/notificaciones.html#mis-compras`,
  };
}

// ============================================================
// Helpers
// ============================================================
function formatARS(n) {
  const v = parseFloat(n) || 0;
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency', currency: 'ARS',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `$${v.toLocaleString('es-AR')}`;
  }
}

module.exports = {
  sendEmail,
  // Templates listos para usar
  passwordResetTemplate,
  orderPaidBuyerTemplate,
  newSaleSellerTemplate,
  orderShippedBuyerTemplate,
};
