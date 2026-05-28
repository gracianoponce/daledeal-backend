-- ============================================================
-- Migración 007: Soporte de Google OAuth
--
-- Agrega columna `google_id` para mappear usuarios autenticados
-- con Google (campo `sub` del ID token de Google, único por user).
--
-- También hace `password_hash` nullable porque los usuarios que se
-- registran solo con Google no tienen contraseña local.
--
-- Idempotente: usa IF NOT EXISTS.
-- ============================================================

BEGIN;

-- 1) Permitir password_hash NULL para usuarios solo-Google
ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL;

-- 2) Columna google_id (sub de Google, único entre todos los usuarios)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);

-- 3) Índice único parcial: solo aplica a rows con google_id no-NULL,
--    así varios users sin Google no chocan en NULL.
CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_unique
  ON users(google_id)
  WHERE google_id IS NOT NULL;

-- 4) Columna avatar_url ya existe en schema.sql original, no hace falta

COMMIT;
