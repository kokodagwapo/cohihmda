-- Migration: Platform Settings
-- Created: 2026-02-04
-- Database: management
--
-- Stores platform-level configuration including API keys for global operations
-- This is used for processing global knowledge documents and other platform-wide features

CREATE TABLE IF NOT EXISTS platform_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key VARCHAR(255) UNIQUE NOT NULL,
    setting_value TEXT,
    encrypted BOOLEAN DEFAULT false,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast key lookups
CREATE INDEX IF NOT EXISTS idx_platform_settings_key ON platform_settings(setting_key);

-- Add common settings
INSERT INTO platform_settings (setting_key, description, encrypted)
VALUES 
    ('openai_api_key', 'OpenAI API key for generating embeddings in global knowledge library', true),
    ('anthropic_api_key', 'Anthropic API key for AI features (optional)', true),
    ('default_embedding_model', 'Default model for embedding generation', false)
ON CONFLICT (setting_key) DO NOTHING;

-- Set default embedding model
UPDATE platform_settings 
SET setting_value = 'text-embedding-3-large'
WHERE setting_key = 'default_embedding_model' AND setting_value IS NULL;

COMMENT ON TABLE platform_settings IS 'Platform-wide configuration settings including encrypted API keys';
COMMENT ON COLUMN platform_settings.setting_key IS 'Unique identifier for the setting';
COMMENT ON COLUMN platform_settings.setting_value IS 'Value of the setting (may be encrypted)';
COMMENT ON COLUMN platform_settings.encrypted IS 'Whether the value is encrypted';
