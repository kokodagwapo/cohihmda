-- Migration: Fallout Email Redirect Toggle
-- Database: management
--
-- Adds a platform setting to explicitly enable email redirection for fallout alerts,
-- independent of NODE_ENV. When enabled + emails are configured, all LO/manager emails
-- are redirected to the configured safe list regardless of environment.

INSERT INTO platform_settings (setting_key, setting_value, encrypted, description)
VALUES (
  'fallout_email_redirect_enabled',
  'false',
  false,
  'When true, all fallout alert emails are redirected to the addresses in fallout_dev_allowed_emails instead of real recipients. Use this to safely test email distribution in any environment.'
)
ON CONFLICT (setting_key) DO NOTHING;
