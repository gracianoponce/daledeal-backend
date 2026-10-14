/**
 * Insignias de usuario y carteles de publicaciones (migración 019).
 *
 *  - Insignias: las asigna un admin (PATCH /admin/users/:id { badges }).
 *    "verificado" y "titulo" no están acá: salen de aprobar la verificación
 *    con documentos. Mismas claves que USER_BADGES del frontend (JS/utils.js).
 *  - Carteles: hasta 2 por publicación, { text, color }, los carga el vendedor
 *    en Publicar. El texto se guarda escapado como el resto de los textos
 *    (sanitizeBody solo escapa los strings del primer nivel del body).
 *
 * query019: corre una consulta que usa las columnas de la 019; si la base
 * todavía no las tiene (42703) la repite sin las líneas marcadas con «/*019*\/»
 * y sin los últimos `dropParams` parámetros, para que el sitio siga andando
 * hasta que se aplique la migración.
 */
const db = require('../config/database');
const { sanitize } = require('../middleware/validate');

const USER_BADGES = [
  'ceo', 'fundador', 'equipo', 'vendedor_fundador', 'empresa_verificada',
  'mejor_vendedor', 'mejor_servicio_mes', 'top_ventas', 'respuesta_rapida', 'envios_rapidos',
];
const MAX_POST_BADGES = 2;
const MAX_BADGE_TEXT  = 20;
const DEFAULT_COLOR   = '#ef4444';
const HEX_COLOR       = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const MARK_019        = /\/\*019\*\//;
// Caracteres de control, de ancho cero y bidi (sirven para disfrazar una
// palabra reservada) y sustitutos UTF-16 sueltos (Postgres rechaza el jsonb).
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
// Un cartel no puede hacerse pasar por una insignia de la plataforma: eso es
// lo que el sitio vende como confianza. Se compara sin acentos ni mayúsculas.
const RESERVED = ['verificado', 'verificada', 'titulo verificado', 'ceo', 'fundador', 'dale deal', 'daledeal',
  'compra protegida', 'admin', 'administrador', 'mercado pago', 'mercadopago'];
const plain = (t) => t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function normalizeUserBadges(raw) {
  if (!Array.isArray(raw)) return { ok: false, error: 'badges debe ser un array de insignias' };
  const badges = [];
  for (const k of raw) {
    if (typeof k !== 'string' || !USER_BADGES.includes(k)) {
      return { ok: false, error: `Insignia desconocida: ${String(k).slice(0, 40)}` };
    }
    if (!badges.includes(k)) badges.push(k);
  }
  return { ok: true, badges };
}

function normalizePostBadges(raw) {
  if (raw === undefined || raw === null) return { ok: true, badges: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'badges debe ser un array de carteles' };
  if (raw.length > MAX_POST_BADGES) return { ok: false, error: `Máximo ${MAX_POST_BADGES} carteles por publicación` };
  const badges = [];
  for (const b of raw) {
    if (!b || typeof b !== 'object' || typeof b.text !== 'string') {
      return { ok: false, error: 'Cada cartel necesita un texto' };
    }
    const text = b.text.replace(INVISIBLE, '').trim();
    if (!text) continue; // cartel vacío: no se guarda
    if (text.length > MAX_BADGE_TEXT) {
      return { ok: false, error: `El texto de un cartel no puede superar los ${MAX_BADGE_TEXT} caracteres` };
    }
    const spaced = ` ${plain(text)} `, compact = spaced.replace(/ /g, '');
    const reserved = RESERVED.find((r) => spaced.includes(` ${r} `) || compact.includes(r.replace(/ /g, '')));
    if (reserved) {
      return { ok: false, error: `El cartel "${text}" no se puede usar: las insignias de la plataforma (verificado, fundador, Compra Protegida…) las asigna Dale Deal.` };
    }
    const color = typeof b.color === 'string' && HEX_COLOR.test(b.color) ? b.color.toLowerCase() : DEFAULT_COLOR;
    badges.push({ text: sanitize(text), color });
  }
  return { ok: true, badges };
}

/** Para guardar: null deja la columna como está (COALESCE), un array la pisa. */
function postBadgesParam(raw) {
  if (raw === undefined || raw === null) return null;
  return JSON.stringify(normalizePostBadges(raw).badges);
}

function withoutMigration019(sql) {
  return sql.replace(/^[^\n]*\/\*019\*\/[^\n]*\n?/gm, '');
}

async function query019(sql, params, dropParams = 0) {
  try {
    return await db.query(sql, params);
  } catch (err) {
    if (err.code !== '42703' || !MARK_019.test(sql)) throw err;
    return db.query(withoutMigration019(sql), dropParams ? params.slice(0, -dropParams) : params);
  }
}

module.exports = {
  USER_BADGES, MAX_POST_BADGES, MAX_BADGE_TEXT, RESERVED,
  normalizeUserBadges, normalizePostBadges, postBadgesParam, query019, withoutMigration019,
};
