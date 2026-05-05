-- ============================================================
-- Migración 004: Reset de contraseña
--
-- Tabla para tokens temporales que permiten al usuario cambiar
-- su contraseña sin haber iniciado sesión. Cada token:
--   - se asocia a un user_id
--   - tiene expiración corta (60 minutos)
--   - se usa una sola vez (used_at marca cuándo se consumió)
--   - cualquier intento previo del mismo usuario se invalida
--     al pedir uno nuevo (limpieza en el endpoint)
--
-- Idempotente.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(128) NOT NULL UNIQUE,  -- guardamos el hash, no el token plano
  expires_at  TIMESTAMP NOT NULL,
  used_at     TIMESTAMP,
  created_at  TIMESTAMP DEFAULT NOW(),
  ip_address  VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_user    ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_expires ON password_reset_tokens(expires_at);

COMMENT ON TABLE password_reset_tokens IS
  'Tokens temporales para que el usuario cambie su contraseña sin loguear';
COMMENT ON COLUMN password_reset_tokens.token_hash IS
  'SHA-256 del token enviado al usuario. El token plano NO se guarda.';

COMMIT;

-- Para correr:
--   psql $DATABASE_URL -f db/migrations/004_password_reset.sql
