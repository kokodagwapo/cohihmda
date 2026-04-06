-- Dual trend: vs previous snapshot (trend) vs first/baseline snapshot (trend_vs_baseline)
ALTER TABLE tracked_insight_snapshots
  ADD COLUMN IF NOT EXISTS trend_vs_baseline TEXT;
