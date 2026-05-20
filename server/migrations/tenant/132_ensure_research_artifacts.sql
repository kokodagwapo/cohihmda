-- Repair migration: tenants that applied version 111 as `user_feedback` (pre-COHI-362)
-- never ran 111_research_artifacts.sql because the runner keys on version number only.
-- Idempotent — safe on fresh tenants that already have research_artifacts from 111.

CREATE TABLE IF NOT EXISTS research_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  headline_fingerprint TEXT,
  sql TEXT NOT NULL,
  key_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  title TEXT,
  viz_config JSONB,
  explanation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_artifacts_user_session
  ON research_artifacts (user_id, session_id);

CREATE INDEX IF NOT EXISTS idx_research_artifacts_session
  ON research_artifacts (session_id);

COMMENT ON TABLE research_artifacts IS
  'Persisted Research Lab SQL evidence for watchlist tracking and Workbench reuse.';

ALTER TABLE tracked_insights
  ADD COLUMN IF NOT EXISTS research_artifact_id UUID REFERENCES research_artifacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tracked_insights_research_artifact
  ON tracked_insights (research_artifact_id)
  WHERE research_artifact_id IS NOT NULL;

COMMENT ON COLUMN tracked_insights.research_artifact_id IS
  'When source_type = research and the row is SQL-backed, links to research_artifacts.';
