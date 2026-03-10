-- Migration: Add platform-level Gemini API key setting
-- Created: 2026-03-10
-- Database: management

INSERT INTO platform_settings (setting_key, description, encrypted)
VALUES (
  'gemini_api_key',
  'Google Gemini API key for platform-level podcast generation fallback',
  true
)
ON CONFLICT (setting_key) DO NOTHING;

