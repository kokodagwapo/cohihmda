-- Migration: 011_insight_training
-- Description: Stores curated positive/negative insight examples for few-shot LLM training.
--              Platform-level table (management DB) shared across all tenants.

CREATE TABLE IF NOT EXISTS insight_training_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id VARCHAR(100) NOT NULL,    -- e.g. 'insights.working', 'insights.attention'
  example_type TEXT NOT NULL CHECK (example_type IN ('positive', 'negative')),
  headline TEXT NOT NULL,
  understory TEXT,
  source_insight_id INT,              -- original insight this came from (nullable, cross-DB reference)
  source_tenant_id TEXT,
  feedback_rating SMALLINT,           -- rating that led to curation
  admin_note TEXT,                     -- curator's note on why this is good/bad
  curated_by UUID NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_examples_prompt ON insight_training_examples(prompt_id, is_active);
CREATE INDEX IF NOT EXISTS idx_training_examples_type ON insight_training_examples(example_type, is_active);
