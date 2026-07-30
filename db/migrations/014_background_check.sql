-- =============================================================
-- Migration 014 — Insignia "Antecedentes verificados"
-- =============================================================
-- Tercer tipo de verificación (pedido de Dylan 22/07): el prestador presenta
-- su Certificado de Antecedentes Penales (RNR, se saca en Mi Argentina) y el
-- equipo lo valida contra la fuente oficial usando el código de verificación
-- del certificado. NO se almacena el certificado ni ningún documento — solo
-- el flag y la fecha (mismo criterio que migration 013, Ley 25.326).
--
-- "Título profesional" NO agrega tipo nuevo: se pliega a la insignia
-- 'professional' existente (matrícula O título, ambos verificables en
-- registros públicos).
--
-- Aditiva e idempotente.
-- =============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verified_background BOOLEAN NOT NULL DEFAULT false;

-- Ampliar el CHECK de tipos: drop + re-add es idempotente en re-runs.
ALTER TABLE verification_requests
  DROP CONSTRAINT IF EXISTS verification_requests_type_check;
ALTER TABLE verification_requests
  ADD CONSTRAINT verification_requests_type_check
  CHECK (type IN ('identity', 'professional', 'background'));
