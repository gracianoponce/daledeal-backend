-- ============================================================
-- Migración 002: Integración con Mercado Pago
--
-- Agrega los campos necesarios a `orders` para guardar el estado
-- del pago en MP, y crea la tabla `payment_events` como log de
-- notificaciones del webhook (auditoría + idempotencia).
--
-- Idempotente: usa IF NOT EXISTS en todo.
-- ============================================================

BEGIN;

-- 1) Nuevas columnas en orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS mp_preference_id     VARCHAR(80),
  ADD COLUMN IF NOT EXISTS mp_payment_id        VARCHAR(80),
  ADD COLUMN IF NOT EXISTS mp_external_reference VARCHAR(80),
  ADD COLUMN IF NOT EXISTS mp_init_point        TEXT,
  ADD COLUMN IF NOT EXISTS mp_sandbox_init_point TEXT,
  ADD COLUMN IF NOT EXISTS commission_rate      DECIMAL(5,4) DEFAULT 0.0500,
  ADD COLUMN IF NOT EXISTS commission_amount    DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_at              TIMESTAMP;

-- Ampliar el CHECK de payment_status para incluir estados intermedios
-- que maneja MP (in_process, authorized, charged_back, rejected).
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN (
    'pending','in_process','authorized','paid',
    'rejected','refunded','failed','charged_back','cancelled'
  ));

-- 2) Índices para lookups rápidos desde el webhook
CREATE INDEX IF NOT EXISTS idx_orders_mp_preference ON orders(mp_preference_id);
CREATE INDEX IF NOT EXISTS idx_orders_mp_payment    ON orders(mp_payment_id);
CREATE INDEX IF NOT EXISTS idx_orders_external_ref  ON orders(mp_external_reference);

-- 3) Tabla de eventos del webhook (log + idempotencia)
CREATE TABLE IF NOT EXISTS payment_events (
  id              SERIAL PRIMARY KEY,
  order_id        INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  mp_payment_id   VARCHAR(80),
  mp_topic        VARCHAR(40),      -- 'payment' | 'merchant_order' | ...
  mp_action       VARCHAR(40),      -- 'payment.created' | 'payment.updated' | ...
  status          VARCHAR(30),      -- estado final registrado
  status_detail   VARCHAR(80),      -- detalle MP (ej: 'accredited', 'cc_rejected_insufficient_amount')
  raw_payload     JSONB,            -- body completo del webhook
  signature_valid BOOLEAN DEFAULT FALSE,
  processed_at    TIMESTAMP DEFAULT NOW(),
  -- idempotencia: si MP reenvía el mismo evento no duplicamos
  request_id      VARCHAR(80) UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_payment_events_order    ON payment_events(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_mp_payment ON payment_events(mp_payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_topic    ON payment_events(mp_topic, processed_at DESC);

-- 4) Tabla de commissions (lo que se le debe liquidar al vendedor)
--    Usamos esto para reportes de liquidación y pagos manuales al seller
--    hasta que migremos a MP Marketplace API.
CREATE TABLE IF NOT EXISTS seller_payouts (
  id                SERIAL PRIMARY KEY,
  seller_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  gross_amount      DECIMAL(12,2) NOT NULL,  -- total_price
  commission_amount DECIMAL(12,2) NOT NULL,  -- comisión retenida
  net_amount        DECIMAL(12,2) NOT NULL,  -- gross - commission
  currency          VARCHAR(3) DEFAULT 'ARS',
  status            VARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','failed','disputed')),
  paid_at           TIMESTAMP,
  notes             TEXT,
  created_at        TIMESTAMP DEFAULT NOW(),
  UNIQUE(order_id)   -- un payout por orden
);

CREATE INDEX IF NOT EXISTS idx_seller_payouts_seller ON seller_payouts(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_seller_payouts_status ON seller_payouts(status, created_at);

COMMIT;

-- ============================================================
-- Para correr esta migración:
--   psql $DATABASE_URL -f db/migrations/002_payments.sql
--   o
--   npm run db:migrate:payments
-- ============================================================
