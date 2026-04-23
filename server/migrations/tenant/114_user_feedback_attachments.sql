CREATE TABLE IF NOT EXISTS user_feedback_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id UUID NOT NULL REFERENCES user_feedback(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  user_id UUID NOT NULL,
  original_file_name TEXT NOT NULL,
  stored_file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes >= 0),
  file_kind TEXT NOT NULL CHECK (file_kind IN ('image', 'data', 'document')),
  storage_provider TEXT NOT NULL DEFAULT 'db' CHECK (storage_provider IN ('db', 's3')),
  storage_key TEXT,
  data BYTEA,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_attachments_feedback_id
  ON user_feedback_attachments(feedback_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_feedback_attachments_tenant_status
  ON user_feedback_attachments(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_attachments_expiry
  ON user_feedback_attachments(status, expires_at)
  WHERE status != 'expired' AND expires_at IS NOT NULL;

DROP TRIGGER IF EXISTS trigger_user_feedback_attachments_updated_at ON user_feedback_attachments;
CREATE TRIGGER trigger_user_feedback_attachments_updated_at
  BEFORE UPDATE ON user_feedback_attachments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
