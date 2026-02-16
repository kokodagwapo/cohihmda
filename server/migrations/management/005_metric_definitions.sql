-- Migration: Metric Definitions and Audit Log
-- Created: 2026-02-02
-- Database: management
--
-- This migration creates tables for:
-- - Storing metric definitions that can be customized per tenant
-- - Tracking changes to metric definitions for audit purposes
--
-- The metrics system allows:
-- - Platform-level default metrics (is_system = true)
-- - Tenant-level custom metrics and overrides
-- - Version history for all changes
-- - Audit logging for compliance

-- =============================================================================
-- METRIC_DEFINITIONS - Central metric registry with version control
-- =============================================================================
-- Stores all metric definitions (both system defaults and custom metrics)
-- System metrics (is_system = true) come from the METRICS_CATALOG in code
-- Custom metrics can be created/modified by tenant admins

CREATE TABLE IF NOT EXISTS metric_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Metric identification
  metric_id VARCHAR(100) NOT NULL,
  tenant_id UUID REFERENCES coheus_tenants(id) ON DELETE CASCADE,
  
  -- Basic info
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL CHECK (category IN ('status', 'turn_time', 'revenue', 'pull_through', 'volume', 'count', 'custom')),
  
  -- Implementation
  formula VARCHAR(500),                     -- Reference formula (e.g., Qlik syntax)
  sql_query TEXT NOT NULL,                  -- PostgreSQL implementation
  default_date_field VARCHAR(50),           -- Default date filter field
  ignore_date_filter BOOLEAN DEFAULT false, -- For point-in-time metrics like active_loans
  
  -- Dependencies and metadata
  dependencies JSONB DEFAULT '[]',          -- Array of metric_ids this depends on
  notes TEXT,                               -- Documentation, caveats, estimation notes
  tags JSONB DEFAULT '[]',                  -- Custom tags for organization
  
  -- Metric behavior flags
  is_active BOOLEAN DEFAULT true,           -- Soft delete
  is_system BOOLEAN DEFAULT true,           -- false = custom metric, true = system default
  is_override BOOLEAN DEFAULT false,        -- true = tenant override of system metric
  
  -- Version control
  version INT DEFAULT 1,
  previous_version_id UUID REFERENCES metric_definitions(id),
  
  -- Audit fields
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES coheus_users(id),
  updated_by UUID REFERENCES coheus_users(id),
  
  -- Unique constraint: one active definition per metric per tenant (or null for system defaults)
  CONSTRAINT unique_active_metric_per_tenant UNIQUE (metric_id, tenant_id, is_active)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_metric_definitions_metric_id ON metric_definitions(metric_id);
CREATE INDEX IF NOT EXISTS idx_metric_definitions_tenant_id ON metric_definitions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_metric_definitions_category ON metric_definitions(category);
CREATE INDEX IF NOT EXISTS idx_metric_definitions_is_system ON metric_definitions(is_system) WHERE is_system = true;
CREATE INDEX IF NOT EXISTS idx_metric_definitions_is_active ON metric_definitions(is_active) WHERE is_active = true;

-- =============================================================================
-- METRIC_AUDIT_LOG - Track all changes to metric definitions
-- =============================================================================
-- Immutable log of all metric definition changes for compliance and rollback

CREATE TABLE IF NOT EXISTS metric_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reference to the metric
  metric_id VARCHAR(100) NOT NULL,
  metric_definition_id UUID REFERENCES metric_definitions(id),
  tenant_id UUID REFERENCES coheus_tenants(id),
  
  -- Change details
  action VARCHAR(20) NOT NULL CHECK (action IN ('create', 'update', 'delete', 'restore', 'override')),
  old_value JSONB,                          -- Previous state (null for create)
  new_value JSONB,                          -- New state (null for delete)
  change_summary TEXT,                      -- Human-readable change description
  
  -- Audit metadata
  changed_by UUID REFERENCES coheus_users(id),
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT,
  
  -- Additional context
  reason TEXT,                              -- Optional reason for the change
  metadata JSONB DEFAULT '{}'               -- Additional context (e.g., API version, source)
);

-- Indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_metric_audit_log_metric_id ON metric_audit_log(metric_id);
CREATE INDEX IF NOT EXISTS idx_metric_audit_log_tenant_id ON metric_audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_metric_audit_log_changed_at ON metric_audit_log(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_metric_audit_log_changed_by ON metric_audit_log(changed_by);
CREATE INDEX IF NOT EXISTS idx_metric_audit_log_action ON metric_audit_log(action);

-- =============================================================================
-- METRIC_USAGE_STATS - Track metric usage for analytics and deprecation
-- =============================================================================
-- Helps identify which metrics are actually being used

CREATE TABLE IF NOT EXISTS metric_usage_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  metric_id VARCHAR(100) NOT NULL,
  tenant_id UUID REFERENCES coheus_tenants(id),
  
  -- Usage tracking
  query_count BIGINT DEFAULT 0,
  last_queried_at TIMESTAMPTZ,
  last_queried_by UUID REFERENCES coheus_users(id),
  
  -- Sources that use this metric
  used_in_dashboards JSONB DEFAULT '[]',    -- Dashboard IDs using this metric
  used_in_reports JSONB DEFAULT '[]',       -- Report IDs using this metric
  used_in_datachat BOOLEAN DEFAULT false,   -- Used in Cohi Chat queries
  
  -- Aggregation period
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_metric_usage_period UNIQUE (metric_id, tenant_id, period_start, period_end)
);

-- Indexes for usage queries
CREATE INDEX IF NOT EXISTS idx_metric_usage_stats_metric_id ON metric_usage_stats(metric_id);
CREATE INDEX IF NOT EXISTS idx_metric_usage_stats_tenant_id ON metric_usage_stats(tenant_id);
CREATE INDEX IF NOT EXISTS idx_metric_usage_stats_period ON metric_usage_stats(period_start, period_end);

-- =============================================================================
-- HELPER FUNCTION: Update timestamp trigger
-- =============================================================================

CREATE OR REPLACE FUNCTION update_metric_definitions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to metric_definitions
DROP TRIGGER IF EXISTS metric_definitions_updated_at ON metric_definitions;
CREATE TRIGGER metric_definitions_updated_at
  BEFORE UPDATE ON metric_definitions
  FOR EACH ROW
  EXECUTE FUNCTION update_metric_definitions_updated_at();

-- =============================================================================
-- COMMENTS for documentation
-- =============================================================================

COMMENT ON TABLE metric_definitions IS 'Central registry of metric definitions with tenant-level customization support';
COMMENT ON TABLE metric_audit_log IS 'Immutable audit log tracking all changes to metric definitions';
COMMENT ON TABLE metric_usage_stats IS 'Usage statistics for metrics to support analytics and deprecation planning';

COMMENT ON COLUMN metric_definitions.is_system IS 'True for platform-provided metrics, false for tenant-created custom metrics';
COMMENT ON COLUMN metric_definitions.is_override IS 'True when a tenant has customized a system metric';
COMMENT ON COLUMN metric_definitions.sql_query IS 'PostgreSQL query fragment - use ${dateRangeClause} for date filtering';
COMMENT ON COLUMN metric_definitions.notes IS 'Documentation including estimation methodology, caveats, and data quality notes';
