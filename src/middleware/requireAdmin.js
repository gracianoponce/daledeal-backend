/**
 * Middleware que verifica que el usuario autenticado sea admin.
 * Debe usarse SIEMPRE después del authMiddleware (que pone req.user).
 *
 * Para máxima seguridad re-consulta el rol en la DB en lugar de
 * confiar solo en el JWT — si un admin es degradado, el cambio
 * surte efecto inmediatamente sin esperar a que el token expire.
 */

const db = require('../config/database');

const requireAdmin = async (req, res, next) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  try {
    const result = await db.query(
      'SELECT role, is_active FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    const { role, is_active } = result.rows[0];
    if (!is_active) {
      return res.status(403).json({ error: 'Cuenta suspendida' });
    }
    if (role !== 'admin') {
      return res.status(403).json({ error: 'Permisos insuficientes — se requiere rol admin' });
    }

    // Hidratar req.user con role fresco
    req.user.role = role;
    next();
  } catch (err) {
    console.error('Error en requireAdmin:', err);
    return res.status(500).json({ error: 'Error verificando permisos' });
  }
};

module.exports = requireAdmin;
