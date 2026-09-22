/**
 * Tracking de envíos.
 *
 * Dos niveles, y el segundo es opcional:
 *
 *  1) Siempre: catálogo de correos + link de seguimiento. El vendedor elige
 *     con qué correo despachó y el comprador recibe un link que lo lleva a la
 *     página del correo (o al envío directo cuando el correo lo permite).
 *
 *  2) Si SHIP24_API_KEY está configurada: registramos el número en Ship24 y
 *     ellos nos empujan cada cambio de estado a POST /webhooks/ship24
 *     (autenticado con SHIP24_WEBHOOK_SECRET). Con eso la entrega la confirma
 *     el correo y no el vendedor, que es lo que le da sentido al escrow.
 *
 * Sin la API key todo lo de (2) queda apagado y nada falla.
 * Docs: https://docs.ship24.com  ·  spec: /assets/openapi/ship24-tracking-api.yaml
 */
const crypto = require('crypto');

const SHIP24_API_URL    = 'https://api.ship24.com/public/v1';
const SHIP24_TIMEOUT_MS = 8000;
const UNIVERSAL_TRACKER = n => `https://www.ship24.com/tracking?p=${encodeURIComponent(n)}`;

// `page`     = página de seguimiento del correo (hay que pegar el número).
// `deepLink` = URL que abre el envío directo. Solo se carga cuando está
//              verificada; inventar un patrón manda al comprador a un 404.
const CARRIERS = [
  { slug: 'correo_argentino', name: 'Correo Argentino', page: 'https://www.correoargentino.com.ar/seguimiento-de-envios' },
  { slug: 'andreani',         name: 'Andreani',         page: 'https://www.andreani.com/?tab=seguir-envio',
    deepLink: n => `https://www.andreani.com/envio/${encodeURIComponent(n)}` },
  { slug: 'oca',              name: 'OCA',              page: 'https://www.oca.com.ar/Seguimiento/BuscarEnvio/paquetes' },
  { slug: 'via_cargo',        name: 'Vía Cargo',        page: 'https://viacargo.com.ar/seguimiento-de-envio/' },
  { slug: 'other',            name: 'Otro correo',      deepLink: UNIVERSAL_TRACKER },
];
const BY_SLUG = new Map(CARRIERS.map(c => [c.slug, c]));

// Hitos de Ship24 (https://docs.ship24.com/status) → texto para el usuario.
const MILESTONES = {
  pending:              'Esperando datos del correo',
  info_received:        'El correo ya tiene los datos del envío',
  in_transit:           'En camino',
  out_for_delivery:     'Sale a reparto hoy',
  failed_attempt:       'Intento de entrega fallido',
  available_for_pickup: 'Listo para retirar en sucursal',
  delivered:            'Entregado',
  exception:            'Problema con el envío',
};

const listCarriers   = () => CARRIERS.map(({ slug, name }) => ({ slug, name }));
const getCarrier     = slug => BY_SLUG.get(slug) || null;
const isValidCarrier = slug => typeof slug === 'string' && BY_SLUG.has(slug);
const isMilestone    = m => typeof m === 'string' && Object.prototype.hasOwnProperty.call(MILESTONES, m);
const statusLabel    = m => (isMilestone(m) ? MILESTONES[m] : null);

function buildTrackingUrl(carrierSlug, trackingNumber) {
  const n = typeof trackingNumber === 'string' ? trackingNumber.trim() : '';
  if (!n) return null;
  const c = getCarrier(carrierSlug);
  if (!c) return UNIVERSAL_TRACKER(n);
  return c.deepLink ? c.deepLink(n) : c.page;
}

// ------------------------------------------------------------
// Ship24
// ------------------------------------------------------------
const isEnabled = () => !!(process.env.SHIP24_API_KEY || '').trim();

const clientTrackerIdFor = orderId => `dd-order-${orderId}`;
function orderIdFromClientTrackerId(v) {
  const m = /^dd-order-(\d{1,10})$/.exec(String(v || ''));
  return m ? parseInt(m[1], 10) : null;
}

// Códigos de courier de Ship24. Arrancan vacíos a propósito: los códigos
// reales salen de GET /public/v1/couriers (pide API key) y sin ellos Ship24
// autodetecta el correo, ayudado por el país. Se cargan sin tocar código:
//   SHIP24_COURIER_CODES='{"andreani":"andreani","oca":"oca-ar"}'
function courierCodeFor(slug) {
  try {
    const map = JSON.parse(process.env.SHIP24_COURIER_CODES || '{}');
    return typeof map[slug] === 'string' && map[slug] ? map[slug] : null;
  } catch {
    return null;
  }
}

/**
 * Da de alta el número en Ship24 (idempotente del lado de ellos).
 * Nunca tira: devuelve { ok:true, trackerId } o { ok:false, skipped|error }.
 */
async function registerTracker({ orderId, trackingNumber, carrier, postalCode }) {
  if (!isEnabled()) return { ok: false, skipped: 'disabled' };

  const number = String(trackingNumber || '').replace(/\s+/g, '');
  // Mismo criterio que valida Ship24: 5–50, letras, números y guiones.
  if (!/^[A-Za-z0-9-]{5,50}$/.test(number)) return { ok: false, skipped: 'invalid_format' };

  const body = {
    trackingNumber:         number,
    clientTrackerId:        clientTrackerIdFor(orderId),
    orderNumber:            String(orderId),
    originCountryCode:      'AR',
    destinationCountryCode: 'AR',
  };
  if (postalCode) body.destinationPostCode = String(postalCode).trim();
  const code = courierCodeFor(carrier);
  if (code) body.courierCode = [code];

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SHIP24_TIMEOUT_MS);
  try {
    const res = await fetch(`${SHIP24_API_URL}/trackers`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json; charset=utf-8',
        'Authorization': `Bearer ${process.env.SHIP24_API_KEY.trim()}`,
      },
      body:   JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = json?.errors?.[0]?.code || json?.errors?.[0]?.message || '';
      return { ok: false, error: `Ship24 respondió ${res.status}${detail ? ' · ' + detail : ''}` };
    }
    const trackerId = json?.data?.tracker?.trackerId;
    return trackerId ? { ok: true, trackerId } : { ok: false, error: 'Ship24 no devolvió trackerId' };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'Ship24 no respondió a tiempo' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ship24 manda `Authorization: Bearer <webhook secret>` en cada webhook.
 * → 'unconfigured' | 'ok' | 'invalid'  (comparación en tiempo constante)
 */
function verifyWebhookSecret(authorizationHeader) {
  const secret = (process.env.SHIP24_WEBHOOK_SECRET || '').trim();
  if (!secret) return 'unconfigured';
  const m = /^Bearer\s+(.+)$/.exec(String(authorizationHeader || ''));
  if (!m) return 'invalid';
  const a = crypto.createHash('sha256').update(m[1].trim()).digest();
  const b = crypto.createHash('sha256').update(secret).digest();
  return crypto.timingSafeEqual(a, b) ? 'ok' : 'invalid';
}

// `datetime` viene en UTC con Z; `occurrenceDatetime` es hora local del
// correo sin zona. Preferimos la primera; la segunda es el plan B.
function parseWhen(ev) {
  for (const v of [ev?.datetime, ev?.occurrenceDatetime]) {
    if (typeof v !== 'string' || !v) continue;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

const clip = (s, max) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null);

/**
 * Normaliza el cuerpo del webhook a lo único que usamos. Tolera basura:
 * nunca tira, descarta lo que no entiende.
 */
function parseWebhookBody(body) {
  const list = body && Array.isArray(body.trackings) ? body.trackings : [];
  return list.filter(t => t && typeof t === 'object').map(t => {
    const events = (Array.isArray(t.events) ? t.events : [])
      .map(ev => ({
        id:          clip(ev?.eventId, 80),
        milestone:   isMilestone(ev?.statusMilestone) ? ev.statusMilestone : null,
        description: clip(ev?.status, 300),
        location:    clip(ev?.location, 200),
        occurredAt:  parseWhen(ev),
      }))
      .filter(ev => ev.id && ev.milestone && ev.occurredAt)
      .sort((a, b) => b.occurredAt - a.occurredAt);

    const generatedAt = parseWhen({ datetime: t.metadata?.generatedAt });
    return {
      orderId:        orderIdFromClientTrackerId(t.tracker?.clientTrackerId),
      trackerId:      clip(t.tracker?.trackerId, 80),
      trackingNumber: clip(t.tracker?.trackingNumber, 80),
      milestone:      isMilestone(t.shipment?.statusMilestone) ? t.shipment.statusMilestone : null,
      statusAt:       events[0]?.occurredAt || generatedAt || new Date(),
      events,
    };
  });
}

module.exports = {
  listCarriers, getCarrier, isValidCarrier, buildTrackingUrl, statusLabel, isMilestone,
  isEnabled, registerTracker, verifyWebhookSecret, parseWebhookBody,
  clientTrackerIdFor, orderIdFromClientTrackerId,
};
