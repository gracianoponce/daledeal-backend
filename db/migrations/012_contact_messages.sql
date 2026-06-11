-- =============================================================
-- Migration 012 — Tabla contact_messages (todos los contactos)
-- =============================================================
--
-- Hoy el form de contacto solo persiste los leads B2B (company_leads).
-- Los contactos "normales" SOLO se mandan por email → si el email no
-- llega (p.ej. CONTACT_INBOX apuntando a una casilla inexistente), el
-- mensaje se pierde sin dejar rastro.
--
-- Esta tabla guarda CADA mensaje de contacto (general y empresa) para
-- que nunca se pierda uno, aunque falle el envío de email. company_leads
-- sigue existiendo para el funnel B2B con status/follow-up.
--
-- Idempotente: CREATE ... IF NOT EXISTS. Aditiva: no toca tablas existentes.
-- =============================================================

CREATE TABLE IF NOT EXISTS contact_messages (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(100)  NOT NULL,
  apellido    VARCHAR(100),
  email       VARCHAR(150)  NOT NULL,
  telefono    VARCHAR(50),
  asunto      VARCHAR(150),
  mensaje     TEXT          NOT NULL,
  tipo        VARCHAR(30)   NOT NULL DEFAULT 'general',  -- 'general' | 'empresa'
  pedido_id   VARCHAR(50),
  -- Metadata
  source_ip   VARCHAR(45),   -- para detectar spam por IP
  user_agent  TEXT,
  created_at  TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- Índices para el admin (listado por fecha, búsqueda por email, filtro por tipo)
CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at ON contact_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_email      ON contact_messages(email);
CREATE INDEX IF NOT EXISTS idx_contact_messages_tipo       ON contact_messages(tipo);
