-- Migration: 031_insight_feedback
-- Description: Stores platform admin feedback (thumbs up/down, tags, comments)
--              on AI-generated insights for RLHF-style training loop.

CREATE TABLE IF NOT EXISTS insight_feedback (
  id SERIAL PRIMARY KEY,
  insight_id INT NOT NULL REFERENCES generated_insights(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  user_email TEXT NOT NULL,
  user_name TEXT,
  rating SMALLINT NOT NULL CHECK (rating IN (-1, 1)),  -- thumbs down / thumbs up
  tags TEXT[] DEFAULT '{}',  -- e.g. {'inaccurate','not_actionable','duplicate','great','actionable'}
  comment TEXT,
  insight_headline TEXT,     -- denormalized for fast review without JOINs
  insight_bucket TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insight_feedback_insight ON insight_feedback(insight_id);
CREATE INDEX IF NOT EXISTS idx_insight_feedback_user ON insight_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_insight_feedback_rating ON insight_feedback(rating, created_at DESC);
