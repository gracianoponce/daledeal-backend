-- =============================================================
-- Migration 010 — Tabla company_leads (B2B funnel)
-- =============================================================
--
-- El link "¿Sos una empresa?" en signup.html redirige a contacto.html
-- ?tipo=empresa. Hoy el form solo envía email (perdés trackability).
--
-- Esta tabla guarda CADA lead B2B con status para que el admin haga
-- follow-up sin perder a nadie en el inbox.
-- =============================================================

CREATE TABLE IF NOT EXISTS company_leads (
  id              SERIAL PRIMARY KEY,
  -- Datos del lead (vienen del form de contacto)
  nombre          VARCHAR(100)  NOT NULL,
  apellido        VARCHAR(100)  NOT NULL,
  email           VARCHAR(150)  NOT NULL,
  telefono        VARCHAR(50),
  asunto          VARCHAR(150),
  mensaje         TEXT          NOT NULL,
  pedido_id       VARCHAR(50),
  -- Tracking interno
  -- 'new'        — recién llegado (default)
  -- 'contacted'  — admin lo contactó al menos 1 vez
  -- 'qualified'  — tiene potencial real de cerrar
  -- 'customer'   — ya es cliente activo
  -- 'lost'       — no cerró (con razón en notes)
  status          VARCHAR(20)   NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new', 'contacted', 'qualified', 'customer', 'lost')),
  notes           TEXT,           -- notas internas del admin (no se muestran al lead)
  -- Metadata
  source_ip       VARCHAR(45),    -- para detectar spam por IP
  user_agent      TEXT,
  created_at      TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- Índices para queries comunes en el admin dashboard
CREATE INDEX IF NOT EXISTS idx_company_leads_status     ON company_leads(status);
CREATE INDEX IF NOT EXISTS idx_company_leads_created_at ON company_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_leads_email      ON company_leads(email);

-- Trigger para que updated_at se actualice automático en cada UPDATE
CREATE OR REPLACE FUNCTION update_company_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_company_leads_updated_at ON company_leads;
CREATE TRIGGER trg_company_leads_updated_at
BEFORE UPDATE ON company_leads
FOR EACH ROW EXECUTE FUNCTION update_company_leads_updated_at();

-- Verificación
SELECT
  'OK' AS status,
  count(*) AS leads_actuales
FROM company_leads;
