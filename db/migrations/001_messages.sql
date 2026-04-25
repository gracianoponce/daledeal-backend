-- ============================================================
-- DALE DEAL - Sistema de Mensajería (conversations + messages)
-- Migración: 001
-- ============================================================
-- Crea las tablas necesarias para que comprador y vendedor
-- puedan chatear cuando se efectúa una compra de producto
-- o se contrata un servicio.
-- ============================================================

-- ============================================================
-- TABLA: conversations
-- Una conversación une a dos usuarios (buyer + seller) alrededor
-- de un producto o servicio específico.
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id               SERIAL PRIMARY KEY,
  buyer_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id       INTEGER REFERENCES products(id) ON DELETE SET NULL,
  service_id       INTEGER REFERENCES services(id) ON DELETE SET NULL,
  order_id         INTEGER REFERENCES orders(id)   ON DELETE SET NULL,
  item_type        VARCHAR(10) NOT NULL CHECK (item_type IN ('product', 'service')),
  last_message     TEXT,
  last_message_at  TIMESTAMP DEFAULT NOW(),
  created_at       TIMESTAMP DEFAULT NOW(),
  CONSTRAINT conversations_valid_pair CHECK (
    (item_type = 'product' AND product_id IS NOT NULL AND service_id IS NULL) OR
    (item_type = 'service' AND service_id IS NOT NULL AND product_id IS NULL)
  ),
  CONSTRAINT conversations_not_self   CHECK (buyer_id <> seller_id)
);

-- Índice único parcial: evita duplicados por producto o servicio
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conv_product
  ON conversations (buyer_id, seller_id, product_id)
  WHERE item_type = 'product';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_conv_service
  ON conversations (buyer_id, seller_id, service_id)
  WHERE item_type = 'service';

CREATE INDEX IF NOT EXISTS idx_conversations_buyer     ON conversations(buyer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_seller    ON conversations(seller_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_msg  ON conversations(last_message_at DESC);

-- ============================================================
-- TABLA: messages
-- Cada mensaje pertenece a una conversación.
-- read_at marca cuándo la otra parte lo leyó.
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL CHECK (length(trim(body)) > 0),
  read_at         TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender       ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_unread       ON messages(conversation_id) WHERE read_at IS NULL;

-- ============================================================
-- TRIGGER: al insertar un mensaje, actualizar last_message
-- y last_message_at en la conversación.
-- ============================================================
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
     SET last_message    = LEFT(NEW.body, 200),
         last_message_at = NEW.created_at
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_conversation_last_message ON messages;
CREATE TRIGGER trg_update_conversation_last_message
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_last_message();
