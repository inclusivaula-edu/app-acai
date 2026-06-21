-- ============================================================
-- AÇAÍ SHOP — Schema Supabase (PostgreSQL)
-- Execute no SQL Editor do Supabase: https://supabase.com
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── VENDORS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendors (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                    TEXT NOT NULL UNIQUE,
  password                 TEXT NOT NULL,
  name                     TEXT NOT NULL,
  phone                    TEXT NOT NULL,
  address                  TEXT NOT NULL,
  cpf                      TEXT NOT NULL UNIQUE,
  role                     TEXT NOT NULL DEFAULT 'vendor' CHECK (role IN ('vendor', 'admin')),
  status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'inactive')),
  -- planos / assinatura
  plan                     TEXT NOT NULL DEFAULT 'trial',
  plan_status              TEXT NOT NULL DEFAULT 'active',
  plan_expires_at          TIMESTAMPTZ,
  stripe_customer_id       TEXT,
  stripe_subscription_id   TEXT,
  -- operação
  deliveries_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── PRODUCTS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id    UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  price        NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  category     TEXT NOT NULL CHECK (category IN ('base', 'bebidas', 'adicionais')),
  emoji        TEXT DEFAULT '🫐',
  image_url    TEXT,
  calories     TEXT,
  ingredients  TEXT,
  allergens    TEXT,
  available    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── DELIVERERS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deliverers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,
  cpf             TEXT,
  vehicle         TEXT,
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── ORDERS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number          TEXT UNIQUE,
  vendor_id             UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,

  -- Dados do cliente (flat)
  customer_name         TEXT NOT NULL,
  customer_email        TEXT,
  customer_phone        TEXT,
  customer_street       TEXT,
  customer_number       TEXT,
  customer_neighborhood TEXT,
  customer_city         TEXT,
  customer_state        TEXT,
  customer_zip          TEXT,

  -- Itens [{product_id, name, price, quantity, emoji}]
  items                 JSONB NOT NULL DEFAULT '[]',

  -- Valores
  subtotal              NUMERIC(10,2) NOT NULL DEFAULT 0,
  delivery_fee          NUMERIC(10,2) NOT NULL DEFAULT 0,
  total                 NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Tipo e status
  delivery_type         TEXT NOT NULL DEFAULT 'retirada' CHECK (delivery_type IN ('retirada', 'entrega')),
  status                TEXT NOT NULL DEFAULT 'aguardando_pagamento'
                          CHECK (status IN ('aguardando_pagamento','confirmado','em_preparo','pronto','em_entrega','entregue','cancelado')),
  payment_status        TEXT NOT NULL DEFAULT 'pendente' CHECK (payment_status IN ('pendente','pago','reembolsado')),
  payment_id            TEXT,

  -- Notas
  customer_notes        TEXT,
  vendor_notes          TEXT,

  -- Entregador
  deliverer_id          UUID REFERENCES deliverers(id) ON DELETE SET NULL,
  deliverer_commission  NUMERIC(10,2),
  commission_paid       BOOLEAN NOT NULL DEFAULT FALSE,
  commission_paid_at    TIMESTAMPTZ,

  -- Timestamps
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Trigger: order_number automático ────────────────────────
CREATE SEQUENCE IF NOT EXISTS order_seq START 1;

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.order_number := 'AC' || TO_CHAR(NOW(), 'YYMM') || LPAD(NEXTVAL('order_seq')::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_order_number ON orders;
CREATE TRIGGER set_order_number
  BEFORE INSERT ON orders
  FOR EACH ROW
  WHEN (NEW.order_number IS NULL OR NEW.order_number = '')
  EXECUTE FUNCTION generate_order_number();

-- ── Índices ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_products_vendor    ON products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_products_category  ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_available ON products(available);
CREATE INDEX IF NOT EXISTS idx_orders_vendor      ON orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_orders_status      ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created     ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_deliverer   ON orders(deliverer_id);
CREATE INDEX IF NOT EXISTS idx_deliverers_vendor  ON deliverers(vendor_id);

-- ── RLS desabilitado (backend usa service_role) ──────────────
ALTER TABLE vendors    DISABLE ROW LEVEL SECURITY;
ALTER TABLE products   DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders     DISABLE ROW LEVEL SECURITY;
ALTER TABLE deliverers DISABLE ROW LEVEL SECURITY;
