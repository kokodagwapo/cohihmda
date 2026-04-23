-- User feedback collection and triage workflow (consolidated migration)
CREATE TABLE IF NOT EXISTS user_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  submitter_email TEXT NOT NULL,
  submitter_name TEXT,
  area TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  admin_notes TEXT,
  in_progress_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  -- Ensure submitter_name exists for older user_feedback tables.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user_feedback'
  ) THEN
    ALTER TABLE user_feedback
      ADD COLUMN IF NOT EXISTS submitter_name TEXT;

    ALTER TABLE user_feedback
      DROP CONSTRAINT IF EXISTS user_feedback_area_check;

    ALTER TABLE user_feedback
      ADD CONSTRAINT user_feedback_area_check
      CHECK (
        area IN (
          'insights',
          'dashboards',
          'workbench',
          'research_lab',
          'communication_center',
          'general_feedback'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_feedback_user_created_at
  ON user_feedback(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_feedback_status_created_at
  ON user_feedback(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_feedback_area_created_at
  ON user_feedback(area, created_at DESC);

DROP TRIGGER IF EXISTS trigger_user_feedback_updated_at ON user_feedback;
CREATE TRIGGER trigger_user_feedback_updated_at
  BEFORE UPDATE ON user_feedback
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
