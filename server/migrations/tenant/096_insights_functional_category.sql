-- Migration: 092_insights_functional_category
-- Description: Adds functional_category column to generated_insights to support
--              per-category agent pipelines (operations, sales, finance,
--              secondary_marketing, compliance). Each insight is now tagged with
--              the functional domain that produced it, enabling tabbed UI views.

ALTER TABLE generated_insights
  ADD COLUMN IF NOT EXISTS functional_category TEXT;

CREATE INDEX IF NOT EXISTS idx_generated_insights_category
  ON generated_insights(functional_category);

-- Composite index for the common UI query: load by category + date filter
CREATE INDEX IF NOT EXISTS idx_generated_insights_category_filter
  ON generated_insights(functional_category, date_filter, generated_at DESC);
