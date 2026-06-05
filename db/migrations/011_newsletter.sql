-- =============================================================
-- Migration 011 — Tabla newsletter_subscribers
-- =============================================================
--
-- El form de "Mantente actualizado" en el footer del sitio hoy es fake
-- (animación de éxito sin enviar nada). Esta tabla persiste los emails
-- de suscriptores para que después el dueño los exporte y mande newsletters
-- desde Resend, Mailchimp, etc.
-- =============================================================

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id              SERIAL PRIMARY KEY,
  email           VARCHAR(150)  NOT NULL UNIQUE,
  source          VARCHAR(50)   DEFAULT 'footer',  -- footer | popup | etc
  source_ip       VARCHAR(45),
  user_agent      TEXT,
  -- Doble opt-in (futuro): hoy todos quedan confirmados directo.
  -- Cuando agreguemos confirmación por email, usar este campo.
  confirmed       BOOLEAN       NOT NULL DEFAULT TRUE,
  unsubscribed_at TIMESTAMP,
  created_at      TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_newsletter_created_at ON newsletter_subscribers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_newsletter_active     ON newsletter_subscribers(email)
  WHERE unsubscribed_at IS NULL;

-- Verificación
SELECT 'OK' AS status, count(*) AS suscriptores_actuales FROM newsletter_subscribers;
