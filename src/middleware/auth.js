const jwt = require('jsonwebtoken');
const db = require('../config/database');

// Los tokens duran 7 días: sin este chequeo, un usuario suspendido por el
// admin (o que desactivó su cuenta) seguía publicando, comprando y mandando
// mensajes hasta que le venciera el token. Cache corto para no ir a la base
// en cada request.
const ACCOUNT_TTL_MS = 60 * 1000;
const accountCache = new Map(); // userId → { suspended, at }

async function isSuspended(userId) {
  const hit = accountCache.get(userId);
  if (hit && Date.now() - hit.at < ACCOUNT_TTL_MS) return hit.suspended;

  const result = await db.query('SELECT is_active FROM users WHERE id = $1', [userId]);
  // Solo bloquea una cuenta que existe y está desactivada explícitamente.
  const suspended = result?.rows?.[0]?.is_active === false;
  if (accountCache.size > 10000) accountCache.clear();
  accountCache.set(userId, { suspended, at: Date.now() });
  return suspended;
}

/**
 * Middleware que verifica el JWT en el header Authorization.
 * Si el token es válido, agrega req.user con los datos del usuario.
 * Uso: agregar `authMiddleware` como segundo argumento en cualquier ruta protegida.
 */
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers['authorization'];

  // El header debe venir como: "Bearer <token>"
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  try {
    if (await isSuspended(decoded.id)) {
      return res.status(401).json({ error: 'Tu cuenta está suspendida o desactivada' });
    }
  } catch (err) {
    // Si la base no responde no cortamos acá: el controller que la necesite
    // va a fallar con su propio error.
    console.error('[auth] No se pudo verificar el estado de la cuenta:', err.message);
  }

  req.user = decoded; // { id, email, role }
  next();
};

module.exports = authMiddleware;
