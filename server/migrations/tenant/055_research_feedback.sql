-- Research feedback table for multi-level feedback on research sessions
CREATE TABLE IF NOT EXISTS research_feedback (
  id SERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('step', 'finding', 'session')),
  target_id TEXT,
  user_id UUID NOT NULL,
  user_email TEXT NOT NULL,
  rating SMALLINT CHECK (rating IN (-1, 1)),
  comment TEXT,
  context_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_feedback_session ON research_feedback(session_id);
CREATE INDEX IF NOT EXISTS idx_research_feedback_type ON research_feedback(target_type, rating);
