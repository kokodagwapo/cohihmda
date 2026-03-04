-- =============================================================================
-- OPERATIONAL_SCORECARD_CONFIG - Tenant-configurable trigger date fields
-- for Operations Scorecard (processor, underwriter, closer).
-- If no rows exist, app falls back to hard-coded OPERATIONS_ACTOR_CONFIGS.
-- =============================================================================
CREATE TABLE IF NOT EXISTS operational_scorecard_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type VARCHAR(50) NOT NULL,
  output_date_field VARCHAR(100) NOT NULL,
  turn_time_start_field VARCHAR(100) NOT NULL,
  turn_time_end_field VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(actor_type)
);

CREATE INDEX IF NOT EXISTS idx_operational_scorecard_config_actor ON operational_scorecard_config(actor_type);
