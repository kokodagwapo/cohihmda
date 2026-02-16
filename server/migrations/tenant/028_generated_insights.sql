-- Migration: 028_generated_insights
-- Description: Stores AI-generated executive insights per tenant, bucketed by category.
--              Replaces in-memory caching so insights persist across server restarts
--              and are only regenerated on-demand via the refresh button.

CREATE TABLE IF NOT EXISTS generated_insights (
  id SERIAL PRIMARY KEY,
  bucket TEXT NOT NULL,               -- 'working', 'attention', 'critical', 'context'
  priority TEXT NOT NULL,             -- 'BLUE', 'YELLOW', 'RED', 'GRAY'
  headline TEXT NOT NULL,             -- max 45 words, executive-grade
  understory TEXT,                    -- 2-3 sentence supporting detail
  insight_type TEXT NOT NULL,         -- 'success', 'warning', 'critical', 'info'
  source TEXT,                        -- predictions, performance, pipeline, credit_risk, etc.
  severity_score DECIMAL(4,2),        -- 0.00-1.00
  impact JSONB DEFAULT '{}',          -- { type, estimated_dollars, units_affected }
  scope JSONB DEFAULT '{}',           -- { channel[], branch[], product[] }
  evidence JSONB DEFAULT '{}',        -- { metrics[], comparisons[] }
  for_podcast BOOLEAN DEFAULT true,
  date_filter TEXT NOT NULL,          -- ytd, mtd, today, etc.
  channel_group TEXT,                 -- optional channel filter used during generation
  generation_batch TEXT NOT NULL,     -- UUID grouping insights from one generation run
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by generation batch (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_generated_insights_batch ON generated_insights(generation_batch);

-- Index for finding latest insights by date filter
CREATE INDEX IF NOT EXISTS idx_generated_insights_lookup ON generated_insights(date_filter, channel_group, generated_at DESC);

-- Index for bucket-based ordering
CREATE INDEX IF NOT EXISTS idx_generated_insights_bucket ON generated_insights(bucket, severity_score DESC);
