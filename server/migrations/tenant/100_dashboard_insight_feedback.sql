-- Migration: 098_dashboard_insight_feedback
-- Description: Stores end-user feedback (thumbs up/down, tags, comments)
--              on AI-generated dashboard insights (separate from generated_insights feedback).

CREATE TABLE IF NOT EXISTS dashboard_insight_feedback (
  id SERIAL PRIMARY KEY,
  dashboard_insight_id INT NOT NULL REFERENCES dashboard_generated_insights(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  user_email TEXT NOT NULL,
  user_name TEXT,
  rating SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
  tags TEXT[] DEFAULT '{}',
  comment TEXT,
  insight_headline TEXT,
  insight_page_id TEXT,
  insight_page_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- One rating per user per dashboard insight
CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_insight_feedback_unique
  ON dashboard_insight_feedback(dashboard_insight_id, user_id);

CREATE INDEX IF NOT EXISTS idx_dashboard_insight_feedback_insight
  ON dashboard_insight_feedback(dashboard_insight_id);

CREATE INDEX IF NOT EXISTS idx_dashboard_insight_feedback_user
  ON dashboard_insight_feedback(user_id);

CREATE INDEX IF NOT EXISTS idx_dashboard_insight_feedback_rating
  ON dashboard_insight_feedback(rating, created_at DESC);

