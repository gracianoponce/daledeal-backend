const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const db     = require('../config/database');
const { validateEmail, validatePassword } = require('../middleware/validate');
const { sendEmail, passwordResetTemplate } = require('../services/email');

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
// POST /auth/forgot-password
// Body: { email }
// Genera un token de reset y lo guarda hasheado en DB.
// SIEMPRE devuelve 200 (no revelamos si el email existe).
// El token plano se loggea en consola (placeholder hasta que
// haya envío de email real). En producción esto va por email.
// ============================================================
const forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email es obligatorio' });

  // Respuesta genérica que SIEMPRE damos, incluso si el email no existe.
  // Evita que un atacante use este endpoint para enumerar emails registrados.
  const genericResponse = {
    message: 'Si el email está registrado, enviamos un link para resetear la contraseña.',
  };

  try {
    const userRes = await db.query(
      'SELECT id, email, name FROM users WHERE email = $1 AND is_active = true',
      [String(email).toLowerCase().trim()]
    );

    if (userRes.rows.length === 0) {
      // Email no existe — devolvemos OK genérico igual.
      return res.json(genericResponse);
    }

    const user = userRes.rows[0];

    // Generar token de 32 bytes (64 chars hex). Solo el hash va a la DB.
    const tokenPlain = crypto.randomBytes(32).toString('hex');
    const tokenHash  = crypto.createHash('sha256').update(tokenPlain).digest('hex');
    const expiresAt  = new Date(Date.now() + 60 * 60 * 1000); // 60 min

    // Invalidar tokens anteriores no usados del mismo usuario
    await db.query(
      `UPDATE password_reset_tokens
          SET used_at = NOW()
        WHERE user_id = $1 AND used_at IS NULL`,
      [user.id]
    );

    // Crear el token nuevo
    await db.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, ip_address)
       VALUES ($1, $2, $3, $4)`,
      [user.id, tokenHash, expiresAt, req.ip || null]
    );

    // Construir URL del frontend (multi-origen separado por comas)
    const frontendBase = (process.env.FRONTEND_URL || 'http://localhost:5500')
      .split(',').map(s => s.trim()).filter(Boolean)[0] || 'http://localhost:5500';
    const resetUrl = `${frontendBase}/HTML/recuperar-contrasena.html?token=${tokenPlain}`;

    // Mandar email con el link de reset.
    // En desarrollo (sin RESEND_API_KEY) loggea a consola para que puedas
    // copiar el link manualmente. En producción manda email real.
    const tpl = passwordResetTemplate({ name: user.name, resetUrl });
    sendEmail({
      to:      user.email,
      subject: tpl.subject,
      html:    tpl.html,
      text:    tpl.text,
    }).catch(err => {
      console.error('[forgotPassword] sendEmail failed:', err.message);
    });

    res.json(genericResponse);
  } catch (err) {
    console.error('Error en forgotPassword:', err);
    // Devolvemos OK genérico igual — no queremos filtrar errores específicos.
    res.json(genericResponse);
  }
};

// ============================================================
// POST /auth/reset-password
// Body: { token, new_password }
// Valida el token, cambia la contraseña, marca el token como usado.
// ============================================================
const resetPassword = async (req, res) => {
  const { token, new_password } = req.body;

  if (!token || !new_password) {
    return res.status(400).json({ error: 'Token y nueva contraseña son obligatorios' });
  }

  const validation = validatePassword(new_password);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const tokenRes = await db.query(
      `SELECT prt.id, prt.user_id, prt.expires_at, prt.used_at,
              u.email, u.is_active
         FROM password_reset_tokens prt
         JOIN users u ON u.id = prt.user_id
        WHERE prt.token_hash = $1`,
      [tokenHash]
    );

    if (tokenRes.rows.length === 0) {
      return res.status(400).json({ error: 'Token inválido o ya utilizado' });
    }

    const t = tokenRes.rows[0];

    if (t.used_at) {
      return res.status(400).json({ error: 'Este link ya fue utilizado. Solicitá uno nuevo.' });
    }
    if (new Date(t.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Este link expiró. Solicitá uno nuevo.' });
    }
    if (!t.is_active) {
      return res.status(403).json({ error: 'La cuenta está inactiva' });
    }

    // Cambiar contraseña + marcar token usado en una transacción
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const newHash = await bcrypt.hash(new_password, 12);
      await client.query(
        'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [newHash, t.user_id]
      );

      await client.query(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1',
        [t.id]
      );

      // Invalidar todos los demás tokens activos de este usuario por seguridad
      await client.query(
        `UPDATE password_reset_tokens
            SET used_at = NOW()
          WHERE user_id = $1 AND used_at IS NULL`,
        [t.user_id]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.json({ message: 'Contraseña actualizada. Ya podés iniciar sesión con la nueva.' });
  } catch (err) {
    console.error('Error en resetPassword:', err);
    res.status(500).json({ error: 'Error al cambiar contraseña' });
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

module.exports = {
  register,
  login,
  me,
  changePassword,
  deactivateAccount,
  forgotPassword,
  resetPassword,
};
