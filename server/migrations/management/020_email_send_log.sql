-- Email send audit log (SOC 2 / compliance)
-- Tracks every outbound email with contains_pii flag.

CREATE TABLE IF NOT EXISTS email_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recipient_email TEXT NOT NULL,
  email_type TEXT NOT NULL,
  contains_pii BOOLEAN NOT NULL DEFAULT false,
  user_id UUID NULL,
  tenant_id TEXT NULL,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_email_send_log_sent_at ON email_send_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_email_send_log_email_type ON email_send_log(email_type);
CREATE INDEX IF NOT EXISTS idx_email_send_log_user_id ON email_send_log(user_id) WHERE user_id IS NOT NULL;
