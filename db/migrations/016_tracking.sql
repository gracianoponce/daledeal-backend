-- ============================================================
-- 016_tracking.sql — Seguimiento de envíos (correo + estados automáticos)
--
-- orders gana: con qué correo se despachó, el último estado informado por el
-- proveedor de tracking y QUIÉN confirmó la entrega. Esto último importa para
-- el escrow (015): delivered_at arranca el reloj de liberación, y no vale lo
-- mismo "lo marcó el vendedor" que "lo confirmó el correo".
--
-- order_tracking_events guarda la línea de tiempo del envío que llega por
-- webhook (Ship24). provider_event_id + UNIQUE la hace idempotente: los
-- reintentos del proveedor no duplican eventos.
--
-- Idempotente. Conviene aplicarla ANTES de deployar el backend que la usa;
-- igual el código tolera que falte (42703/42P01 → responde sin tracking).
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_carrier     VARCHAR(30),
  ADD COLUMN IF NOT EXISTS tracking_status      VARCHAR(30),
  ADD COLUMN IF NOT EXISTS tracking_status_at   TIMESTAMP,
  ADD COLUMN IF NOT EXISTS tracking_provider_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS delivered_source     VARCHAR(10);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivered_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_delivered_source_check
  CHECK (delivered_source IS NULL OR delivered_source IN ('seller','carrier','buyer'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_tracking_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_tracking_status_check
  CHECK (tracking_status IS NULL OR tracking_status IN
    ('pending','info_received','in_transit','out_for_delivery',
     'failed_attempt','available_for_pickup','delivered','exception'));

COMMENT ON COLUMN orders.shipping_carrier IS
  'Slug del correo elegido por el vendedor (catálogo en src/services/tracking.js). Sin CHECK a propósito: sumar un correo no debe requerir migration';
COMMENT ON COLUMN orders.tracking_status IS
  'Último hito informado por el proveedor de tracking (NULL = sin tracking automático)';
COMMENT ON COLUMN orders.tracking_provider_id IS
  'trackerId de Ship24 para este número de seguimiento';
COMMENT ON COLUMN orders.delivered_source IS
  'Quién marcó la entrega: seller (a mano) · carrier (webhook del correo) · buyer (confirmó recepción)';

CREATE TABLE IF NOT EXISTS order_tracking_events (
  id                BIGSERIAL PRIMARY KEY,
  order_id          INTEGER      NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider_event_id VARCHAR(80)  NOT NULL,
  status            VARCHAR(30)  NOT NULL,
  description       VARCHAR(300),
  location          VARCHAR(200),
  occurred_at       TIMESTAMP    NOT NULL,
  created_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_tracking_events_order
  ON order_tracking_events (order_id, occurred_at DESC);
