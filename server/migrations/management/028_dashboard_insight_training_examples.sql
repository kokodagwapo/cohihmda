-- Migration: 028_dashboard_insight_training_examples
-- Description: Stores curated dashboard insight examples for few-shot prompt shaping.
--              Platform-level table (management DB) shared across tenants.

CREATE TABLE IF NOT EXISTS dashboard_insight_training_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id VARCHAR(100),
  prompt_id VARCHAR(100) NOT NULL,
  example_type TEXT NOT NULL CHECK (example_type IN ('positive', 'negative')),
  headline TEXT NOT NULL,
  understory TEXT,
  filter_context JSONB,
  evidence_refs JSONB,
  source_dashboard_insight_id INT,
  source_tenant_id TEXT,
  feedback_rating SMALLINT CHECK (feedback_rating IN (-1, 1)),
  admin_note TEXT,
  curated_by UUID NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dash_training_prompt_active_created
  ON dashboard_insight_training_examples(prompt_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dash_training_page_prompt_active
  ON dashboard_insight_training_examples(page_id, prompt_id, is_active);

CREATE INDEX IF NOT EXISTS idx_dash_training_feedback_rating
  ON dashboard_insight_training_examples(feedback_rating);
