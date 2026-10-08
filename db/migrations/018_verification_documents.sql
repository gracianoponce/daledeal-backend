-- ============================================================
-- 018_verification_documents.sql — Documentos de verificación (temporales)
--
-- Archivos que sube el prestador para verificar identidad (DNI frente/dorso,
-- foto de la cara) y título. Viven SOLO mientras el pedido está pendiente:
-- al aprobar o rechazar se borran (reviewVerification) y queda en
-- verification_requests qué documento se vio (nombre, número, título).
-- Esta tabla queda fuera del backup diario (--exclude-table-data).
-- Aditiva e idempotente.
-- ============================================================
CREATE TABLE IF NOT EXISTS verification_documents (
  id         SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES verification_requests(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       VARCHAR(20) NOT NULL CHECK (kind IN ('dni_front', 'dni_back', 'selfie', 'title')),
  mime       VARCHAR(40) NOT NULL,
  bytes      BYTEA NOT NULL,
  size       INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_verif_docs_request ON verification_documents(request_id);

ALTER TABLE verification_requests
  ADD COLUMN IF NOT EXISTS document_name       VARCHAR(120),
  ADD COLUMN IF NOT EXISTS document_number     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS credential          VARCHAR(160),
  ADD COLUMN IF NOT EXISTS documents_purged_at TIMESTAMP;
