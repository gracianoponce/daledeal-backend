-- ============================================================
-- DALE DEAL - Esquema de Base de Datos PostgreSQL
-- ============================================================

-- Extensión para UUID (opcional pero útil a futuro)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLA: users
-- ============================================================
CREATE TABLE users (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar_url  TEXT,
  phone       VARCHAR(30),
  location    VARCHAR(150),
  role        VARCHAR(20) DEFAULT 'user',       -- 'user' | 'admin'
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- TABLA: product_categories
-- ============================================================
CREATE TABLE product_categories (
  id    SERIAL PRIMARY KEY,
  name  VARCHAR(100) NOT NULL,
  slug  VARCHAR(100) UNIQUE NOT NULL,
  icon  VARCHAR(50)
);

-- ============================================================
-- TABLA: products
-- ============================================================
CREATE TABLE products (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(255) NOT NULL,
  description   TEXT,
  price         DECIMAL(12, 2) NOT NULL,
  currency      VARCHAR(3) DEFAULT 'ARS',
  stock         INTEGER DEFAULT 0,
  condition     VARCHAR(20) DEFAULT 'new',      -- 'new' | 'used'
  category_id   INTEGER REFERENCES product_categories(id) ON DELETE SET NULL,
  seller_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  images        TEXT[],                          -- array de URLs
  location      VARCHAR(150),
  status        VARCHAR(20) DEFAULT 'active',    -- 'active' | 'paused' | 'sold'
  views         INTEGER DEFAULT 0,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- TABLA: service_categories
-- ============================================================
CREATE TABLE service_categories (
  id    SERIAL PRIMARY KEY,
  name  VARCHAR(100) NOT NULL,
  slug  VARCHAR(100) UNIQUE NOT NULL,
  icon  VARCHAR(50)
);

-- ============================================================
-- TABLA: services
-- ============================================================
CREATE TABLE services (
  id             SERIAL PRIMARY KEY,
  title          VARCHAR(255) NOT NULL,
  description    TEXT,
  price_from     DECIMAL(12, 2),
  price_to       DECIMAL(12, 2),
  currency       VARCHAR(3) DEFAULT 'ARS',
  price_type     VARCHAR(20) DEFAULT 'fixed',   -- 'fixed' | 'hourly' | 'quote'
  category_id    INTEGER REFERENCES service_categories(id) ON DELETE SET NULL,
  provider_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  images         TEXT[],
  location       VARCHAR(150),
  zones_covered  TEXT[],                         -- zonas de cobertura
  status         VARCHAR(20) DEFAULT 'active',   -- 'active' | 'paused'
  views          INTEGER DEFAULT 0,
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- INDICES para búsquedas frecuentes
-- ============================================================
CREATE INDEX idx_products_seller     ON products(seller_id);
CREATE INDEX idx_products_category   ON products(category_id);
CREATE INDEX idx_products_status     ON products(status);
CREATE INDEX idx_services_provider   ON services(provider_id);
CREATE INDEX idx_services_category   ON services(category_id);
CREATE INDEX idx_services_status     ON services(status);

-- ============================================================
-- TABLA: favorites
-- ============================================================
CREATE TABLE favorites (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type  VARCHAR(10) NOT NULL CHECK (item_type IN ('product', 'service')),
  item_id    INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, item_type, item_id)
);

CREATE INDEX idx_favorites_user      ON favorites(user_id);
CREATE INDEX idx_favorites_item      ON favorites(item_type, item_id);

-- ============================================================
-- TABLA: orders
-- ============================================================
CREATE TABLE orders (
  id               SERIAL PRIMARY KEY,
  buyer_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id       INTEGER REFERENCES products(id) ON DELETE SET NULL,
  quantity         INTEGER NOT NULL DEFAULT 1,
  unit_price       DECIMAL(12,2) NOT NULL,
  total_price      DECIMAL(12,2) NOT NULL,
  currency         VARCHAR(3) DEFAULT 'ARS',
  status           VARCHAR(20) DEFAULT 'pending'
                   CHECK (status IN ('pending','confirmed','shipped','delivered','cancelled')),
  payment_method   VARCHAR(30) DEFAULT 'pending',
  payment_status   VARCHAR(20) DEFAULT 'pending'
                   CHECK (payment_status IN ('pending','paid','refunded','failed')),
  shipping_address TEXT,
  notes            TEXT,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_orders_buyer    ON orders(buyer_id);
CREATE INDEX idx_orders_seller   ON orders(seller_id);
CREATE INDEX idx_orders_product  ON orders(product_id);
CREATE INDEX idx_orders_status   ON orders(status);

-- ============================================================
-- TABLA: reviews
-- ============================================================
CREATE TABLE reviews (
  id           SERIAL PRIMARY KEY,
  reviewer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type    VARCHAR(10) NOT NULL CHECK (item_type IN ('product', 'service')),
  item_id      INTEGER NOT NULL,
  rating       SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title        VARCHAR(150),
  body         TEXT,
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW(),
  UNIQUE(reviewer_id, item_type, item_id)
);

CREATE INDEX idx_reviews_item      ON reviews(item_type, item_id);
CREATE INDEX idx_reviews_reviewer  ON reviews(reviewer_id);
