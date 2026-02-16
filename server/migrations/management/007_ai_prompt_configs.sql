-- Migration: AI Prompt Configs
-- Created: 2026-02-03
-- Database: management
-- Description: Create tables for AI prompt configuration management with version tracking

-- Main prompt configuration table
CREATE TABLE IF NOT EXISTS ai_prompt_configs (
  id VARCHAR(100) PRIMARY KEY,  -- e.g., 'data_chat.query_generation'
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,  -- 'data_chat', 'insights', 'voice', 'predictions', 'metrics', 'recommendations', 'news'

  -- Prompt content
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT,  -- Optional template with {{variables}}

  -- Model configuration
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  temperature NUMERIC(3,2) NOT NULL DEFAULT 0.7,
  max_tokens INTEGER NOT NULL DEFAULT 1000,
  json_mode BOOLEAN NOT NULL DEFAULT false,

  -- Context variables (documents what variables are available)
  available_variables JSONB NOT NULL DEFAULT '[]',

  -- Defaults (original hardcoded values for reset)
  default_system_prompt TEXT NOT NULL,
  default_user_prompt_template TEXT,
  default_model TEXT NOT NULL,
  default_temperature NUMERIC(3,2) NOT NULL,
  default_max_tokens INTEGER NOT NULL,

  -- Audit
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Version history table for tracking changes
CREATE TABLE IF NOT EXISTS ai_prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id VARCHAR(100) NOT NULL REFERENCES ai_prompt_configs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT,
  model TEXT NOT NULL,
  temperature NUMERIC(3,2) NOT NULL,
  max_tokens INTEGER NOT NULL,
  json_mode BOOLEAN NOT NULL DEFAULT false,
  change_summary TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(prompt_id, version)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_prompt_configs_category ON ai_prompt_configs(category);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_configs_active ON ai_prompt_configs(is_active);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_versions_prompt_id ON ai_prompt_versions(prompt_id);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_versions_created_at ON ai_prompt_versions(created_at DESC);

-- Comments for documentation
COMMENT ON TABLE ai_prompt_configs IS 'Stores AI prompt configurations for all services (data chat, insights, predictions, etc.)';
COMMENT ON TABLE ai_prompt_versions IS 'Version history for AI prompt changes with audit trail';
COMMENT ON COLUMN ai_prompt_configs.id IS 'Unique identifier in format: category.purpose (e.g., data_chat.query_generation)';
COMMENT ON COLUMN ai_prompt_configs.available_variables IS 'JSON array of variable names that can be used in templates';
COMMENT ON COLUMN ai_prompt_configs.default_system_prompt IS 'Original hardcoded prompt value for reset functionality';
