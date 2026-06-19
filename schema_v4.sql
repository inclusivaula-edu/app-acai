-- ============================================================
-- AÇAÍ SHOP — Schema v4
-- Execute no SQL Editor do Supabase
-- ============================================================

-- Confirmação de pagamento de comissões
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS commission_paid    BOOLEAN    NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS commission_paid_at TIMESTAMPTZ;

-- Habilitar/desabilitar entregas por vendor
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS deliveries_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Imagem dos produtos
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Status aguardando_pagamento (se ainda não estiver no CHECK)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('aguardando_pagamento','confirmado','em_preparo','pronto','em_entrega','entregue','cancelado'));
