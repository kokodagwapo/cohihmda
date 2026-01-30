-- Migration: RBAC and Fallout Predictions
-- Created: 2026-01-29
-- Database: tenant
--
-- Creates tables for:
-- - Role-based access control (RBAC)
-- - AI-powered fallout predictions
-- - Pattern learning storage

-- =============================================================================
-- TENANT_ROLES - Custom tenant roles with permissions
-- =============================================================================
CREATE TABLE IF NOT EXISTS tenant_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  section_access TEXT[] DEFAULT '{}',
  permissions JSONB DEFAULT '{}',
  is_system_role BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name)
);

CREATE INDEX IF NOT EXISTS idx_tenant_roles_name ON tenant_roles(name);
CREATE INDEX IF NOT EXISTS idx_tenant_roles_active ON tenant_roles(is_active) WHERE is_active = true;

-- Seed default roles
INSERT INTO tenant_roles (name, description, section_access, permissions, is_system_role)
VALUES 
  ('Admin', 'Full access to all features and data', 
   ARRAY['insights', 'loans', 'leaderboard', 'funnel', 'reports', 'data_quality', 'users', 'settings', 'data_chat'],
   '{"fieldRestrictions": []}'::jsonb, true),
  ('Manager', 'Access to insights and team data',
   ARRAY['insights', 'loans', 'leaderboard', 'funnel', 'reports', 'data_chat'],
   '{"fieldRestrictions": []}'::jsonb, true),
  ('Loan Officer', 'Access to own loans only',
   ARRAY['insights', 'loans', 'funnel', 'data_chat'],
   '{"fieldRestrictions": ["branch_price_concession", "corporate_price_concession", "net_buy", "net_sell"]}'::jsonb, true),
  ('Processor', 'Access to assigned loans',
   ARRAY['insights', 'loans', 'funnel'],
   '{"fieldRestrictions": ["branch_price_concession", "corporate_price_concession", "net_buy", "net_sell", "srp_from_investor"]}'::jsonb, true),
  ('Viewer', 'Read-only access to insights',
   ARRAY['insights'],
   '{"fieldRestrictions": ["branch_price_concession", "corporate_price_concession", "net_buy", "net_sell", "srp_from_investor", "pa_srp_amt", "pa_sell_amt"]}'::jsonb, true)
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- USER_ROLE_ASSIGNMENTS - Maps users to roles
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES tenant_roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_role_assignments_user_id ON user_role_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_role_assignments_role_id ON user_role_assignments(role_id);

-- =============================================================================
-- ROLE_FIELD_FILTERS - Row-level filters for roles
-- =============================================================================
CREATE TABLE IF NOT EXISTS role_field_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES tenant_roles(id) ON DELETE CASCADE,
  field_name VARCHAR(255) NOT NULL,
  operator VARCHAR(50) NOT NULL,  -- 'eq', 'neq', 'in', 'contains', 'starts_with'
  value TEXT,
  dynamic_source VARCHAR(100),  -- 'current_user.branch', 'current_user.team', etc.
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_role_field_filters_role_id ON role_field_filters(role_id);

-- =============================================================================
-- LOAN_PREDICTIONS - AI prediction results
-- =============================================================================
CREATE TABLE IF NOT EXISTS loan_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id TEXT NOT NULL,
  predicted_outcome TEXT NOT NULL CHECK (predicted_outcome IN ('withdraw', 'deny', 'originate')),
  confidence INTEGER NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  reasoning TEXT,
  risk_factors TEXT[],
  bucket TEXT DEFAULT 'medium',
  loan_data JSONB,
  model_version TEXT DEFAULT 'gpt-4o',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(loan_id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_loan_predictions_loan ON loan_predictions(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_predictions_outcome ON loan_predictions(predicted_outcome);
CREATE INDEX IF NOT EXISTS idx_loan_predictions_created ON loan_predictions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loan_predictions_confidence ON loan_predictions(confidence);

-- =============================================================================
-- AI_PATTERN_LEARNINGS - AI-extracted patterns from historical data
-- =============================================================================
CREATE TABLE IF NOT EXISTS ai_pattern_learnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_type TEXT NOT NULL DEFAULT 'historical_patterns',
  pattern_summary TEXT NOT NULL,
  historical_loan_count INTEGER NOT NULL,
  date_range_start DATE,
  date_range_end DATE,
  model_version TEXT DEFAULT 'gpt-4o',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_ai_pattern_learnings_type ON ai_pattern_learnings(learning_type);
CREATE INDEX IF NOT EXISTS idx_ai_pattern_learnings_active ON ai_pattern_learnings(is_active) WHERE is_active = true;

-- =============================================================================
-- HISTORICAL_LOAN_BUCKET_CACHE - Cached bucket snapshots for predictions
-- =============================================================================
CREATE TABLE IF NOT EXISTS historical_loan_bucket_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id TEXT NOT NULL UNIQUE,
  bucket_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historical_loan_bucket_cache_loan ON historical_loan_bucket_cache(loan_id);

-- =============================================================================
-- LOAN_OUTCOME_EMBEDDINGS - Vector embeddings for RAG predictions
-- Requires pgvector extension
-- =============================================================================
DO $$
BEGIN
  -- Only create if pgvector is available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE TABLE IF NOT EXISTS loan_outcome_embeddings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      loan_id TEXT NOT NULL UNIQUE,
      outcome TEXT NOT NULL CHECK (outcome IN ('withdraw', 'deny', 'originate')),
      canonical_text TEXT NOT NULL,
      embedding vector(1536) NOT NULL,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS idx_loan_outcome_embeddings_loan ON loan_outcome_embeddings(loan_id);
    CREATE INDEX IF NOT EXISTS idx_loan_outcome_embeddings_outcome ON loan_outcome_embeddings(outcome);
  END IF;
END $$;

-- =============================================================================
-- TRIGGERS
-- =============================================================================
DROP TRIGGER IF EXISTS trigger_tenant_roles_updated_at ON tenant_roles;
CREATE TRIGGER trigger_tenant_roles_updated_at
  BEFORE UPDATE ON tenant_roles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_loan_predictions_updated_at ON loan_predictions;
CREATE TRIGGER trigger_loan_predictions_updated_at
  BEFORE UPDATE ON loan_predictions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_ai_pattern_learnings_updated_at ON ai_pattern_learnings;
CREATE TRIGGER trigger_ai_pattern_learnings_updated_at
  BEFORE UPDATE ON ai_pattern_learnings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
