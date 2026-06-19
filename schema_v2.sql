-- ============================================================
-- AÇAÍ SHOP — Schema v2: entregadores + status pagamento
-- Execute no SQL Editor do Supabase
-- ============================================================

-- ── Nova tabela: ENTREGADORES ────────────────────────────────
CREATE TABLE IF NOT EXISTS deliverers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,
  cpf             TEXT UNIQUE,
  vehicle         TEXT,
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE deliverers DISABLE ROW LEVEL SECURITY;

-- ── Adicionar colunas de entregador nos pedidos ──────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deliverer_id         UUID REFERENCES deliverers(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deliverer_commission NUMERIC(10,2);

-- ── Atualizar constraint de status (adiciona aguardando_pagamento) ──
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('aguardando_pagamento','confirmado','em_preparo','pronto','em_entrega','entregue','cancelado'));

-- ── Índices ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_deliverers_vendor   ON deliverers(vendor_id);
CREATE INDEX IF NOT EXISTS idx_orders_deliverer    ON orders(deliverer_id);
