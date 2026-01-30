-- Migration: Provisioning History Table
-- Created: 2026-01-29
-- Database: management
--
-- Tracks tenant provisioning requests and their status

CREATE TABLE IF NOT EXISTS provisioning_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES coheus_tenants(id) ON DELETE SET NULL,
  tenant_slug TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('create', 'migrate', 'upgrade', 'delete', 'restore')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
  requested_by UUID REFERENCES coheus_users(id) ON DELETE SET NULL,
  cluster_id TEXT,
  database_name TEXT,
  step_function_execution_arn TEXT,
  steps_completed JSONB DEFAULT '[]',
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provisioning_history_tenant ON provisioning_history(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_provisioning_history_status ON provisioning_history(status);
CREATE INDEX IF NOT EXISTS idx_provisioning_history_created ON provisioning_history(created_at DESC);

-- Apply updated_at trigger
DROP TRIGGER IF EXISTS trigger_provisioning_history_updated_at ON provisioning_history;
CREATE TRIGGER trigger_provisioning_history_updated_at
  BEFORE UPDATE ON provisioning_history
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
