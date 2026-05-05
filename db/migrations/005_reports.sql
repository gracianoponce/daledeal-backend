-- ============================================================
-- Migración 005: Reportar problema
--
-- Tabla para que cualquier usuario (autenticado o no) pueda
-- reportar problemas: técnicos, de pagos, contenido inapropiado,
-- intentos de fraude, etc.
--
-- El admin panel los lista para resolución.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS problem_reports (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- null si no estaba logueado
  reporter_email VARCHAR(255),                                     -- email del que reporta (logueado o no)
  category      VARCHAR(40) NOT NULL,
  subject       VARCHAR(200),
  body          TEXT NOT NULL,
  url           TEXT,                                              -- URL desde donde reportó
  user_agent    TEXT,
  ip_address    VARCHAR(64),
  status        VARCHAR(20) DEFAULT 'open'
                CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed')),
  admin_notes   TEXT,
  resolved_at   TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_status   ON problem_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_category ON problem_reports(category);
CREATE INDEX IF NOT EXISTS idx_reports_user     ON problem_reports(user_id);

COMMENT ON COLUMN problem_reports.category IS
  'technical | payment | content | fraud | account | shipping | other';

COMMIT;

-- Para correr:
--   psql $DATABASE_URL -f db/migrations/005_reports.sql
