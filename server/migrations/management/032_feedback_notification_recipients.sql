-- Migration: Feedback Notification Recipients
-- Database: management
--
-- Stores the global list of recipients for feedback submission notifications.
-- Recipients can be existing platform users or manually entered users.

CREATE TABLE IF NOT EXISTS feedback_notification_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES coheus_users(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_notification_recipients_email_unique
  ON feedback_notification_recipients (LOWER(TRIM(email)));

