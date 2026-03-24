-- Migration: Fallout Dev Allowed Emails
-- Database: management
--
-- Adds a platform setting for managing dev-safe email addresses that receive
-- redirected fallout alert emails in non-production environments.

INSERT INTO platform_settings (setting_key, setting_value, encrypted, description)
VALUES (
  'fallout_dev_allowed_emails',
  '[]',
  false,
  'JSON array of email addresses that receive redirected fallout alert emails in non-production environments. Prevents real LO/manager emails from being sent during dev/staging testing.'
)
ON CONFLICT (setting_key) DO NOTHING;
