-- Migration 055: Agent-driven insights engine + tracked insights
-- Adds generation_method to generated_insights for parallel run,
-- creates tracked_insights watchlist and tracked_insight_snapshots time-series tables.

-- 1. Add generation_method column to generated_insights
ALTER TABLE generated_insights
  ADD COLUMN IF NOT EXISTS generation_method TEXT NOT NULL DEFAULT 'pipeline';

CREATE INDEX IF NOT EXISTS idx_generated_insights_method
  ON generated_insights (generation_method);

-- 2. Tracked insights watchlist
CREATE TABLE IF NOT EXISTS tracked_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_email TEXT,
  headline TEXT NOT NULL,
  understory TEXT,
  metric_signature JSONB NOT NULL,
  source_insight_id INTEGER REFERENCES generated_insights(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL DEFAULT 'pipeline',
  status TEXT NOT NULL DEFAULT 'active',
  alert_threshold JSONB,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracked_insights_user
  ON tracked_insights (user_id, status);

CREATE INDEX IF NOT EXISTS idx_tracked_insights_tenant_active
  ON tracked_insights (status) WHERE status = 'active';

-- 3. Tracked insight snapshots (time-series)
CREATE TABLE IF NOT EXISTS tracked_insight_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracked_insight_id UUID NOT NULL REFERENCES tracked_insights(id) ON DELETE CASCADE,
  metric_values JSONB NOT NULL,
  previous_values JSONB,
  change_summary TEXT,
  trend TEXT NOT NULL DEFAULT 'new',
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracked_snapshots_insight
  ON tracked_insight_snapshots (tracked_insight_id, evaluated_at DESC);
