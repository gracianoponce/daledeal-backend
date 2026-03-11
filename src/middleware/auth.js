const jwt = require('jsonwebtoken');

/**
 * Middleware que verifica el JWT en el header Authorization.
 * Si el token es válido, agrega req.user con los datos del usuario.
 * Uso: agregar `authMiddleware` como segundo argumento en cualquier ruta protegida.
 */
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  // El header debe venir como: "Bearer <token>"
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

module.exports = authMiddleware;
