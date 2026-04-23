-- Add feedback type classification for user feedback submissions.
ALTER TABLE user_feedback
  ADD COLUMN IF NOT EXISTS type TEXT;

UPDATE user_feedback
SET type = COALESCE(type, 'question')
WHERE type IS NULL;

ALTER TABLE user_feedback
  ALTER COLUMN type SET DEFAULT 'question';

ALTER TABLE user_feedback
  ALTER COLUMN type SET NOT NULL;

ALTER TABLE user_feedback
  DROP CONSTRAINT IF EXISTS user_feedback_type_check;

ALTER TABLE user_feedback
  ADD CONSTRAINT user_feedback_type_check
  CHECK (type IN ('feature_request', 'bug_issue', 'question'));

CREATE INDEX IF NOT EXISTS idx_user_feedback_type_created_at
  ON user_feedback(type, created_at DESC);
