-- Migration: Demo Tenant Tracking
-- Created: 2026-03-10
-- Database: management
--
-- Adds metadata to support demo tenant refresh and auto-refresh from source tenants.

ALTER TABLE coheus_tenants
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE coheus_tenants
  ADD COLUMN IF NOT EXISTS source_tenant_id UUID REFERENCES coheus_tenants(id) ON DELETE SET NULL;

ALTER TABLE coheus_tenants
  ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMPTZ;

ALTER TABLE coheus_tenants
  ADD COLUMN IF NOT EXISTS auto_refresh BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_coheus_tenants_source
  ON coheus_tenants(source_tenant_id)
  WHERE source_tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coheus_tenants_is_demo
  ON coheus_tenants(is_demo);
