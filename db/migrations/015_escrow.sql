-- =============================================================
-- Migration 015 — Escrow / Compra Protegida (retención hasta entrega)
-- =============================================================
-- El pago del comprador queda RETENIDO hasta que (a) el comprador confirme
-- la recepción, o (b) pasen 7 días desde la entrega sin reclamo (la regla
-- se evalúa al listar la cola de liberación — no hay cron; el payout es
-- manual vía MP y acá queda el registro).
--
-- Se apoya en columnas existentes: paid_at + commission_amount (002),
-- delivered_at / dispatched_at (003).
--
-- Aditiva e idempotente.
-- =============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS buyer_confirmed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS release_status     VARCHAR(20) NOT NULL DEFAULT 'retained'
    CHECK (release_status IN ('retained', 'held', 'released', 'refunded')),
  ADD COLUMN IF NOT EXISTS released_at        TIMESTAMP;

COMMENT ON COLUMN orders.buyer_confirmed_at IS
  'Cuándo el comprador confirmó la recepción (dispara la liberación del pago)';
COMMENT ON COLUMN orders.release_status IS
  'retained=plata retenida | held=frenada por reclamo | released=liberada al vendedor | refunded=devuelta al comprador';

CREATE INDEX IF NOT EXISTS idx_orders_release ON orders(release_status);

-- Registro de liberaciones al vendedor (una por orden como máximo).
CREATE TABLE IF NOT EXISTS payouts (
  id                SERIAL PRIMARY KEY,
  order_id          INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  seller_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  gross_amount      DECIMAL(12,2) NOT NULL,
  commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_amount        DECIMAL(12,2) NOT NULL,
  currency          VARCHAR(3) DEFAULT 'ARS',
  -- manual_mp = transferencia MP→MP hecha a mano (MVP). Con Split de Pagos
  -- se suma 'mp_split' y la ejecuta MP automáticamente.
  method            VARCHAR(20) NOT NULL DEFAULT 'manual_mp',
  reference         TEXT,   -- nro de operación de la transferencia MP
  note              TEXT,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payouts_seller ON payouts(seller_id);
