-- ============================================================
-- MIGRAÇÃO v5 — Multi-tenant: slug por loja
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_slug ON vendors(slug) WHERE slug IS NOT NULL;
