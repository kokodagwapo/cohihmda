-- Migration: Tenant Configuration Tables
-- Created: 2026-01-29
-- Database: tenant
--
-- Creates tables for tenant self-service configuration:
-- - personas (user-defined roles/personas)
-- - config_versions (versioning for all config types)
-- - custom_fields (additional LOS fields)
-- - range_rules (guideline thresholds)
-- - saved_filters (user-defined filters)
-- - scoring_weights (TopTiering weights)
-- - complexity_components (loan complexity scoring)

-- =============================================================================
-- PERSONAS - User-defined personas beyond defaults
-- =============================================================================
CREATE TABLE IF NOT EXISTS personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  permissions JSONB DEFAULT '{}',
  dashboard_config JSONB DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name)
);

CREATE INDEX IF NOT EXISTS idx_personas_is_system ON personas(is_system);

-- Seed default system personas
INSERT INTO personas (name, description, is_system, permissions)
VALUES 
  ('Lender Admin', 'Full tenant configuration access', TRUE, 
    '{"can_manage_fields": true, "can_manage_filters": true, "can_manage_ranges": true, "can_manage_scoring": true, "can_manage_personas": true}'::jsonb),
  ('Operations Manager', 'Manages operational filters and complexity rules', TRUE,
    '{"can_manage_filters": true, "can_view_complexity": true, "can_view_turn_times": true}'::jsonb),
  ('Sales Manager', 'Consumes TopTiering insights and prioritization', TRUE,
    '{"can_view_toptiering": true, "can_manage_filters": true, "can_view_revenue": true}'::jsonb),
  ('Executive', 'Views summarized insights and trends', TRUE,
    '{"can_view_dashboards": true, "can_view_reports": true}'::jsonb),
  ('Analyst', 'Builds dashboards and saved views', TRUE,
    '{"can_manage_filters": true, "can_create_reports": true, "can_view_all_data": true}'::jsonb)
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- CONFIG_VERSIONS - Versioning for all config types
-- =============================================================================
CREATE TABLE IF NOT EXISTS config_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_type VARCHAR(50) NOT NULL,  -- 'field_mapping', 'range_rule', 'filter', 'scoring_weight', 'persona', 'complexity'
  config_id UUID,
  config_data JSONB NOT NULL,
  version_number INT NOT NULL DEFAULT 1,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES users(id),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_config_versions_type ON config_versions(config_type);
CREATE INDEX IF NOT EXISTS idx_config_versions_config_id ON config_versions(config_id) WHERE config_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_config_versions_status ON config_versions(status);

-- =============================================================================
-- CUSTOM_FIELDS - Additional LOS fields beyond Coheus defaults
-- =============================================================================
CREATE TABLE IF NOT EXISTS custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  los_field_id VARCHAR(255) NOT NULL,
  los_field_name VARCHAR(255),
  coheus_alias VARCHAR(255),
  display_name VARCHAR(255) NOT NULL,
  data_type VARCHAR(50) NOT NULL CHECK (data_type IN ('string', 'number', 'date', 'boolean', 'currency', 'percentage')),
  category VARCHAR(100),
  description TEXT,
  is_enabled BOOLEAN DEFAULT TRUE,
  is_custom BOOLEAN DEFAULT TRUE,
  visible_to_personas UUID[],
  formatting_rules JSONB DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(los_field_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_fields_category ON custom_fields(category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_custom_fields_enabled ON custom_fields(is_enabled) WHERE is_enabled = TRUE;

-- =============================================================================
-- RANGE_RULES - Guideline thresholds for highlighting
-- =============================================================================
CREATE TABLE IF NOT EXISTS range_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_alias VARCHAR(255) NOT NULL,
  rule_name VARCHAR(255) NOT NULL,
  description TEXT,
  conditions JSONB DEFAULT '{}',
  min_value DECIMAL(12,4),
  max_value DECIMAL(12,4),
  warning_min DECIMAL(12,4),
  warning_max DECIMAL(12,4),
  severity VARCHAR(20) DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  tooltip_text TEXT,
  violation_message TEXT,
  highlight_color VARCHAR(7),
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_range_rules_field ON range_rules(field_alias);
CREATE INDEX IF NOT EXISTS idx_range_rules_active ON range_rules(is_active) WHERE is_active = TRUE;

-- Seed default range rules
INSERT INTO range_rules (field_alias, rule_name, description, min_value, max_value, warning_min, warning_max, severity, conditions)
VALUES 
  ('ltv_ratio', 'Standard LTV Limits', 'LTV must be ≤97% for conventional, warning at 95%+', NULL, 97, NULL, 95, 'warning', '{}'::jsonb),
  ('ltv_ratio', 'FHA LTV Limits', 'FHA LTV must be ≤96.5%', NULL, 96.5, NULL, 95, 'warning', '{"loan_type": "FHA"}'::jsonb),
  ('be_dti_ratio', 'QM DTI Limits', 'DTI should be ≤43% for QM, warning at 40%+', NULL, 43, NULL, 40, 'warning', '{}'::jsonb),
  ('fico_score', 'Minimum FICO', 'FICO should be ≥620, warning below 680', 620, NULL, 680, NULL, 'warning', '{}'::jsonb),
  ('loan_amount', 'Jumbo Threshold', 'Jumbo loans (≥$726,200) require additional docs', NULL, 726200, NULL, 700000, 'info', '{}'::jsonb)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- SAVED_FILTERS - User-defined filters
-- =============================================================================
CREATE TABLE IF NOT EXISTS saved_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  filter_expression JSONB NOT NULL,
  scope VARCHAR(50) NOT NULL CHECK (scope IN ('personal', 'team', 'persona', 'organization')),
  owner_id UUID REFERENCES users(id),
  owner_persona_id UUID REFERENCES personas(id),
  team_ids UUID[],
  is_locked BOOLEAN DEFAULT FALSE,
  is_default BOOLEAN DEFAULT FALSE,
  icon VARCHAR(50),
  color VARCHAR(7),
  sort_order INT DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_filters_owner ON saved_filters(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_saved_filters_scope ON saved_filters(scope);
CREATE INDEX IF NOT EXISTS idx_saved_filters_persona ON saved_filters(owner_persona_id) WHERE owner_persona_id IS NOT NULL;

-- =============================================================================
-- SCORING_WEIGHTS - TopTiering and other scorecard weights
-- =============================================================================
CREATE TABLE IF NOT EXISTS scoring_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scorecard_type VARCHAR(50) NOT NULL,
  persona_id UUID REFERENCES personas(id),
  metric_name VARCHAR(100) NOT NULL,
  weight DECIMAL(5,4) NOT NULL CHECK (weight >= 0 AND weight <= 1),
  is_active BOOLEAN DEFAULT TRUE,
  description TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(scorecard_type, persona_id, metric_name)
);

CREATE INDEX IF NOT EXISTS idx_scoring_weights_type ON scoring_weights(scorecard_type);
CREATE INDEX IF NOT EXISTS idx_scoring_weights_persona ON scoring_weights(persona_id) WHERE persona_id IS NOT NULL;

-- Seed default scoring weights
-- Use partial unique index match for ON CONFLICT since persona_id NULLs
-- are not equal in standard UNIQUE constraints
INSERT INTO scoring_weights (scorecard_type, persona_id, metric_name, weight, description)
VALUES 
  ('sales', NULL, 'pull_through', 0.30, 'Pull-through percentage weight'),
  ('sales', NULL, 'revenue', 0.25, 'Revenue per loan weight'),
  ('sales', NULL, 'volume', 0.20, 'Loan volume weight'),
  ('sales', NULL, 'turn_time', 0.25, 'Turn time (inverse) weight'),
  ('operations', NULL, 'turn_time', 0.40, 'Turn time weight'),
  ('operations', NULL, 'pull_through', 0.30, 'Pull-through percentage weight'),
  ('operations', NULL, 'volume', 0.30, 'Volume processed weight')
ON CONFLICT (scorecard_type, metric_name) WHERE persona_id IS NULL DO NOTHING;

-- =============================================================================
-- COMPLEXITY_COMPONENTS - Loan complexity score configuration
-- =============================================================================
CREATE TABLE IF NOT EXISTS complexity_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_name VARCHAR(100) NOT NULL,
  condition_value VARCHAR(255) NOT NULL,
  weight DECIMAL(5,4) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(component_name, condition_value)
);

CREATE INDEX IF NOT EXISTS idx_complexity_components_name ON complexity_components(component_name);

-- Seed default complexity components
INSERT INTO complexity_components (component_name, condition_value, weight, description)
VALUES 
  ('loan_purpose', 'C to P', 0.30, 'Construction-to-Permanent'),
  ('loan_purpose', 'Purchase', 0.10, 'Standard purchase'),
  ('loan_purpose', 'Refi CO', 0.10, 'Cash-out refinance'),
  ('loan_purpose', 'Refi No CO', 0.00, 'Rate/term refinance'),
  ('loan_type', 'FHA', 0.10, 'Government program'),
  ('loan_type', 'VA', 0.05, 'VA loan'),
  ('loan_type', 'Conventional', 0.00, 'Standard'),
  ('loan_amount', 'jumbo', 0.10, 'Jumbo loans'),
  ('occupancy', 'SecondHome', 0.10, 'Second home'),
  ('occupancy', 'Investor', 0.10, 'Investment property'),
  ('occupancy', 'Primary', 0.00, 'Primary residence'),
  ('fico', 'excellent', -0.10, 'FICO > 760'),
  ('fico', 'good', 0.00, 'FICO 681-760'),
  ('fico', 'fair', 0.05, 'FICO 620-681'),
  ('fico', 'poor', 0.15, 'FICO ≤620'),
  ('ltv', 'high', 0.05, 'LTV ≥95%'),
  ('dti', 'high', 0.05, 'DTI ≥43%'),
  ('employment', 'self_employed', 0.20, 'Self-employed borrower')
ON CONFLICT (component_name, condition_value) DO NOTHING;

-- =============================================================================
-- TRIGGERS
-- =============================================================================
DROP TRIGGER IF EXISTS trigger_personas_updated_at ON personas;
CREATE TRIGGER trigger_personas_updated_at
  BEFORE UPDATE ON personas
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_custom_fields_updated_at ON custom_fields;
CREATE TRIGGER trigger_custom_fields_updated_at
  BEFORE UPDATE ON custom_fields
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_range_rules_updated_at ON range_rules;
CREATE TRIGGER trigger_range_rules_updated_at
  BEFORE UPDATE ON range_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_saved_filters_updated_at ON saved_filters;
CREATE TRIGGER trigger_saved_filters_updated_at
  BEFORE UPDATE ON saved_filters
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_scoring_weights_updated_at ON scoring_weights;
CREATE TRIGGER trigger_scoring_weights_updated_at
  BEFORE UPDATE ON scoring_weights
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_complexity_components_updated_at ON complexity_components;
CREATE TRIGGER trigger_complexity_components_updated_at
  BEFORE UPDATE ON complexity_components
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
