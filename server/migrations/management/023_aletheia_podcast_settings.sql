-- Migration: Aletheia podcast prefetch settings
-- Created: 2026-03-10
-- Database: management

INSERT INTO platform_settings (setting_key, description, encrypted, setting_value)
VALUES
  (
    'aletheia_nightly_prefetch_enabled',
    'Enable nightly queued generation of Aletheia podcast assets for all active tenants',
    false,
    'false'
  ),
  (
    'aletheia_nightly_prefetch_last_run_at',
    'UTC timestamp of the most recent nightly Aletheia prefetch enqueue run',
    false,
    NULL
  )
ON CONFLICT (setting_key) DO NOTHING;

