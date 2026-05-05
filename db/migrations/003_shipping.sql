-- ============================================================
-- Migración 003: Logística (envíos + retiro en persona)
--
-- Modelo:
--   - Cada producto declara si requiere envío y qué métodos
--     ofrece (delivery, pickup, o ambos).
--   - Si ofrece delivery, el vendedor pone un costo fijo.
--   - Si ofrece pickup, el vendedor declara la zona/dirección.
--   - Cada orden guarda qué método eligió el comprador, y si
--     fue delivery, los datos de envío completos.
--   - El número de tracking lo carga el vendedor cuando despacha.
--
-- Idempotente: usa IF NOT EXISTS / CHECK en todo.
-- ============================================================

BEGIN;

-- 1) Productos: declaración de opciones de envío
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS shipping_required BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS offers_delivery   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS offers_pickup     BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS shipping_cost     DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS pickup_address    TEXT;

COMMENT ON COLUMN products.shipping_required IS
  'TRUE si es un producto físico que requiere algún tipo de logística';
COMMENT ON COLUMN products.offers_delivery IS
  'El vendedor ofrece envío a domicilio';
COMMENT ON COLUMN products.offers_pickup IS
  'El vendedor permite retiro en persona';
COMMENT ON COLUMN products.shipping_cost IS
  'Costo fijo del envío en la moneda del producto. NULL si no ofrece delivery';
COMMENT ON COLUMN products.pickup_address IS
  'Zona o dirección donde se puede retirar (texto libre, ej: "Palermo, CABA")';

-- 2) Órdenes: método elegido + dirección + tracking
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_method        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS shipping_cost          DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_recipient_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS shipping_phone         VARCHAR(30),
  ADD COLUMN IF NOT EXISTS shipping_street        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS shipping_city          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS shipping_province      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS shipping_postal_code   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS shipping_notes         TEXT,
  ADD COLUMN IF NOT EXISTS tracking_number        VARCHAR(80),
  ADD COLUMN IF NOT EXISTS dispatched_at          TIMESTAMP,
  ADD COLUMN IF NOT EXISTS delivered_at           TIMESTAMP;

-- Restricción de método (drop+add para que sea idempotente)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_shipping_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_shipping_method_check
  CHECK (shipping_method IS NULL OR shipping_method IN ('delivery','pickup'));

COMMENT ON COLUMN orders.shipping_method IS
  '"delivery" = envío a domicilio · "pickup" = retiro en persona · NULL = sin logística';
COMMENT ON COLUMN orders.shipping_cost IS
  'Costo del envío que cobró el vendedor (snapshot al momento de la orden)';
COMMENT ON COLUMN orders.tracking_number IS
  'Número de seguimiento del courier (Correo Argentino, Andreani, etc.)';

-- 3) Índices
CREATE INDEX IF NOT EXISTS idx_orders_shipping_method ON orders(shipping_method);
CREATE INDEX IF NOT EXISTS idx_orders_tracking        ON orders(tracking_number)
  WHERE tracking_number IS NOT NULL;

COMMIT;

-- ============================================================
-- Para correr esta migración:
--   psql $DATABASE_URL -f db/migrations/003_shipping.sql
-- ============================================================
