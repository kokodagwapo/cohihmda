-- Migration: 094_dashboard_insights_supporting_data
-- Description: Add supporting_data JSONB to store by-period metrics for evidence table in the UI.
--              Also ensures the base table exists (safety net if 093 was skipped due to version collision).

CREATE TABLE IF NOT EXISTS dashboard_generated_insights (
  id SERIAL PRIMARY KEY,
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  headline TEXT NOT NULL,
  understory TEXT,
  sentiment TEXT NOT NULL,
  severity_score DECIMAL(4,2),
  scope TEXT NOT NULL DEFAULT 'page',
  escalate BOOLEAN NOT NULL DEFAULT false,
  what_changed TEXT,
  why TEXT,
  business_impact TEXT,
  risk_if_ignored TEXT,
  recommended_action TEXT,
  owner TEXT,
  filter_context JSONB NOT NULL DEFAULT '{}',
  evidence_refs JSONB NOT NULL DEFAULT '[]',
  cited_numbers JSONB DEFAULT '[]',
  generation_batch TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_insights_page
  ON dashboard_generated_insights(page_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_dashboard_insights_escalate
  ON dashboard_generated_insights(escalate) WHERE escalate = true;

CREATE INDEX IF NOT EXISTS idx_dashboard_insights_batch
  ON dashboard_generated_insights(generation_batch);

ALTER TABLE dashboard_generated_insights
  ADD COLUMN IF NOT EXISTS supporting_data JSONB DEFAULT NULL;

COMMENT ON COLUMN dashboard_generated_insights.supporting_data IS 'Snapshot of by-period metrics (e.g. MTD/LM/QTD) for evidence table display.';
