-- ============================================================
-- Migración 006: Índices de performance
--
-- Endpoints críticos que ordenan/filtran:
--   - GET /orders/my       → buyer_id + created_at DESC
--   - GET /orders/sales    → seller_id + created_at DESC
--   - GET /products?seller_id=&sort=created_at
--   - GET /reviews/user/:userId
--   - GET /messages/conversations
--
-- Idempotente.
-- ============================================================

BEGIN;

-- Listados de "Mis compras" / "Mis ventas"
CREATE INDEX IF NOT EXISTS idx_orders_buyer_created
  ON orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_seller_created
  ON orders (seller_id, created_at DESC);

-- Búsqueda por external_reference y por mp_payment_id (webhook)
CREATE INDEX IF NOT EXISTS idx_orders_mp_external_ref
  ON orders (mp_external_reference);
CREATE INDEX IF NOT EXISTS idx_orders_mp_payment_id
  ON orders (mp_payment_id);

-- Listado de productos por seller (Mis publicaciones)
CREATE INDEX IF NOT EXISTS idx_products_seller_created
  ON products (seller_id, created_at DESC);

-- Listado de servicios por proveedor
CREATE INDEX IF NOT EXISTS idx_services_provider_created
  ON services (provider_id, created_at DESC);

-- Reviews por item (ya hay un índice (item_type, item_id) si se creó en
-- schema.sql; si no, lo agregamos)
CREATE INDEX IF NOT EXISTS idx_reviews_item
  ON reviews (item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer
  ON reviews (reviewer_id, created_at DESC);

-- Conversaciones — búsquedas por participante
CREATE INDEX IF NOT EXISTS idx_conversations_buyer
  ON conversations (buyer_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_seller
  ON conversations (seller_id, last_message_at DESC);

-- Mensajes por conversación
CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON messages (conversation_id, created_at DESC);

-- Favoritos: buscar por usuario
CREATE INDEX IF NOT EXISTS idx_favorites_user
  ON favorites (user_id, created_at DESC);

COMMIT;

-- Para correr:
--   psql $DATABASE_URL -f db/migrations/006_indexes.sql
