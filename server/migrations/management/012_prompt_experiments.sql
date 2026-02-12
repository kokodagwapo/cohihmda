-- Migration: 012_prompt_experiments
-- Description: Supports A/B testing of prompt variants. Each experiment defines
--              an alternative system prompt that receives a configurable % of traffic.

CREATE TABLE IF NOT EXISTS prompt_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id VARCHAR(100) NOT NULL,    -- references ai_prompt_configs.id
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','completed','archived')),
  variant_system_prompt TEXT NOT NULL,
  variant_model TEXT,
  variant_temperature NUMERIC(3,2),
  variant_max_tokens INTEGER,
  traffic_pct INTEGER NOT NULL DEFAULT 50 CHECK (traffic_pct BETWEEN 0 AND 100),
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prompt_experiments_prompt ON prompt_experiments(prompt_id, status);
CREATE INDEX IF NOT EXISTS idx_prompt_experiments_status ON prompt_experiments(status);
