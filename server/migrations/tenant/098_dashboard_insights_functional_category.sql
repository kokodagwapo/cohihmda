-- Migration 098: Add functional_category column to dashboard_generated_insights
-- Maps dashboard page insights to functional categories (operations, sales, finance, etc.)

ALTER TABLE dashboard_generated_insights
  ADD COLUMN IF NOT EXISTS functional_category TEXT;

CREATE INDEX IF NOT EXISTS idx_dashboard_insights_func_category
  ON dashboard_generated_insights(functional_category);
