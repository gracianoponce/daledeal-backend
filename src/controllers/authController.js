const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../config/database');
const { validateEmail, validatePassword } = require('../middleware/validate');

// ============================================================
// POST /auth/register
// ============================================================
const register = async (req, res) => {
  const { name, email, password, phone, location } = req.body;

  // Validaciones
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios' });
  }
  if (name.length < 2 || name.length > 100) {
    return res.status(400).json({ error: 'El nombre debe tener entre 2 y 100 caracteres' });
  }

  const emailValidation = validateEmail(email);
  if (!emailValidation.ok) {
    return res.status(400).json({ error: emailValidation.message });
  }

  const passwordValidation = validatePassword(password);
  if (!passwordValidation.ok) {
    return res.status(400).json({ error: passwordValidation.message });
  }

  try {
    // Verificar si el email ya existe
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }

    // Hash de la contraseña
    const password_hash = await bcrypt.hash(password, 12); // 12 rounds (más seguro que 10)

    // Insertar usuario
    const result = await db.query(
      `INSERT INTO users (name, email, password_hash, phone, location)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, phone, location, created_at`,
      [name.trim(), email.toLowerCase(), password_hash, phone || null, location || null]
    );

    const user = result.rows[0];

    const token = generateToken(user);

    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Error en register:', err);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
};

// ============================================================
// POST /auth/login
// ============================================================
const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
  }

  try {
    const result = await db.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email.toLowerCase()]
    );

    // Mensaje genérico para no revelar si el email existe
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = generateToken(user);
    const { password_hash, ...userSafe } = user;

    res.json({ token, user: userSafe });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
};

// ============================================================
// POST /auth/change-password
// ============================================================
const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Contraseña actual y nueva son obligatorias' });
  }

  const validation = validatePassword(newPassword);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.message });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'La nueva contraseña debe ser diferente a la actual' });
  }

  try {
    const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    const isMatch = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!isMatch) return res.status(401).json({ error: 'Contraseña actual incorrecta' });

    const newHash = await bcrypt.hash(newPassword, 12);
    await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.user.id]);

    res.json({ message: 'Contraseña actualizada exitosamente' });
  } catch (err) {
    console.error('Error en changePassword:', err);
    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
};

// ============================================================
// GET /auth/me
// ============================================================
const me = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, email, phone, location, avatar_url, role, created_at, updated_at
       FROM users WHERE id = $1 AND is_active = true`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en me:', err);
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
};

// ============================================================
// POST /auth/deactivate
// Desactiva la cuenta del usuario autenticado.
// ============================================================
const deactivateAccount = async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Ingresá tu contraseña para confirmar' });
  }

  try {
    const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const isMatch = await bcrypt.compare(password, result.rows[0].password_hash);
    if (!isMatch) return res.status(401).json({ error: 'Contraseña incorrecta' });

    await db.query('UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1', [req.user.id]);
    res.json({ message: 'Cuenta desactivada. Podés volver a activarla contactando a soporte.' });
  } catch (err) {
    console.error('Error en deactivateAccount:', err);
    res.status(500).json({ error: 'Error al desactivar cuenta' });
  }
};

// ============================================================
// Helper: genera JWT
// ============================================================
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role || 'user' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

module.exports = { register, login, me, changePassword, deactivateAccount };
