-- ============================================================
-- AÇAÍ SHOP — Schema v3: planos de assinatura
-- Execute no SQL Editor do Supabase
-- ============================================================

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS plan         TEXT NOT NULL DEFAULT 'trial'
    CHECK (plan IN ('trial','monthly','semiannual','annual')),
  ADD COLUMN IF NOT EXISTS plan_status  TEXT NOT NULL DEFAULT 'active'
    CHECK (plan_status IN ('active','expired','canceled')),
  ADD COLUMN IF NOT EXISTS plan_expires_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
