-- Migration: 093_dashboard_generated_insights
-- Description: Stores AI-generated dashboard insights per tenant, per page.
--              Separate from generated_insights; escalated rows surface in Aletheia Critical bucket.

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

  -- ETM fields
  what_changed TEXT,
  why TEXT,
  business_impact TEXT,
  risk_if_ignored TEXT,
  recommended_action TEXT,
  owner TEXT,

  -- Filter context (the exact filters that produced this insight)
  filter_context JSONB NOT NULL DEFAULT '{}',

  -- Evidence refs (widget references for UI highlighting)
  evidence_refs JSONB NOT NULL DEFAULT '[]',

  -- Cited numbers
  cited_numbers JSONB DEFAULT '[]',

  -- Generation metadata
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
