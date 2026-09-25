/**
 * Datos de cobro del vendedor: alias, CVU o CBU donde le transferimos cuando
 * se libera el pago de una venta (Compra Protegida). Validación del servidor.
 *
 *  - CBU / CVU: 22 dígitos con los dos dígitos verificadores del BCRA
 *    (bloque 1: 7 dígitos + verificador · bloque 2: 13 dígitos + verificador).
 *    Los CVU (billeteras virtuales, como Mercado Pago) empiezan con 000.
 *  - Alias: 6 a 20 caracteres, letras, números, punto y guion. Se guarda en
 *    mayúsculas (no distingue mayúsculas y así se muestra en las apps).
 */
const W1 = [7, 1, 3, 9, 7, 1, 3];
const W2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];

const checkDigit = (digits, weights) => {
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  return (10 - (sum % 10)) % 10;
};

function isValidCbu(value) {
  if (!/^\d{22}$/.test(value)) return false;
  return checkDigit(value.slice(0, 7), W1) === Number(value[7])
      && checkDigit(value.slice(8, 21), W2) === Number(value[21]);
}

/**
 * Normaliza y valida lo que escribió el vendedor.
 * → { ok: true, value, kind: 'alias' | 'cvu' | 'cbu' } | { ok: false, error }
 */
function normalizePayoutAccount(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return { ok: false, error: 'Ingresá tu alias, CVU o CBU.' };

  // Sin letras: tiene que ser un CBU o CVU (se aceptan espacios, puntos o guiones al tipearlo).
  if (!/[A-Za-z]/.test(trimmed)) {
    const digits = trimmed.replace(/[\s.-]/g, '');
    if (!/^\d+$/.test(digits)) return { ok: false, error: 'Usá solo letras, números, punto o guion.' };
    if (digits.length !== 22) return { ok: false, error: 'El CBU o CVU tiene 22 números.' };
    if (!isValidCbu(digits)) return { ok: false, error: 'Ese CBU o CVU no es válido: revisá los números.' };
    return { ok: true, value: digits, kind: digits.startsWith('000') ? 'cvu' : 'cbu' };
  }

  if (/\s/.test(trimmed)) return { ok: false, error: 'El alias no lleva espacios.' };
  if (!/^[A-Za-z0-9.-]{6,20}$/.test(trimmed)) {
    return { ok: false, error: 'El alias tiene entre 6 y 20 caracteres: letras, números, punto o guion.' };
  }
  return { ok: true, value: trimmed.toUpperCase(), kind: 'alias' };
}

function normalizeHolder(raw) {
  const v = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (v.length < 3) return { ok: false, error: 'Ingresá el nombre del titular de la cuenta.' };
  if (v.length > 120) return { ok: false, error: 'El nombre del titular es demasiado largo.' };
  return { ok: true, value: v };
}

// "Alias X" / "CVU 000…" / "CBU 285…" para mostrar en mails, admin y auditoría.
function describePayoutAccount(value) {
  if (!value) return null;
  if (/^\d{22}$/.test(value)) {
    const kind = value.startsWith('000') ? 'cvu' : 'cbu';
    return { kind, label: `${kind.toUpperCase()} ${value}` };
  }
  return { kind: 'alias', label: `Alias ${value}` };
}

module.exports = { normalizePayoutAccount, normalizeHolder, describePayoutAccount, isValidCbu };
