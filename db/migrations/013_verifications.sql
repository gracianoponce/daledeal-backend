-- =============================================================
-- Migration 013 — Verificación de prestadores (insignias de confianza)
-- =============================================================
-- Sistema de verificación MANUAL (MVP): el equipo aprueba por videollamada
-- (identidad) o chequeo de matrícula en el registro público (profesional).
-- NO se almacenan datos biométricos ni fotos de DNI → evita el tratamiento de
-- datos sensibles de la Ley 25.326. La automatización (KYC/facial) se suma
-- después con un proveedor que maneje el compliance.
--
-- Aditiva e idempotente: ADD COLUMN IF NOT EXISTS / CREATE ... IF NOT EXISTS.
-- =============================================================

-- Insignias que quedan "prendidas" en el usuario al aprobarse.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verified_identity     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_professional BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at           TIMESTAMP;

-- Cola de pedidos de verificación (lo que revisa el admin).
CREATE TABLE IF NOT EXISTS verification_requests (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         VARCHAR(20) NOT NULL CHECK (type IN ('identity', 'professional')),
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),
  -- Datos que aporta el prestador (NO documentos): cómo contactarlo para la
  -- videollamada, o el número de matrícula a chequear. Texto libre acotado.
  contact_note TEXT,
  admin_note   TEXT,                                   -- nota interna del revisor
  reviewed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMP,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verif_status ON verification_requests(status);
CREATE INDEX IF NOT EXISTS idx_verif_user   ON verification_requests(user_id);

-- Un solo pedido PENDIENTE por (usuario, tipo) a la vez — evita spam de la cola.
CREATE UNIQUE INDEX IF NOT EXISTS idx_verif_one_pending
  ON verification_requests(user_id, type)
  WHERE status = 'pending';
