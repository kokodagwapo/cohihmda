-- Migration: RAG and AI Settings
-- Created: 2026-01-29
-- Database: tenant
--
-- Creates tables for RAG (Retrieval Augmented Generation) and AI features:
-- - rag_settings (tenant-wide AI configuration)
-- - rag_document_sources (document source configuration)
-- - rag_documents (individual document tracking)
-- - rag_knowledge_base (admin-managed knowledge entries)

-- =============================================================================
-- RAG_SETTINGS - Tenant-wide AI configuration
-- =============================================================================
CREATE TABLE IF NOT EXISTS rag_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Embedding/RAG configuration
  embedding_model TEXT DEFAULT 'text-embedding-3-small',
  vector_database TEXT DEFAULT 'pgvector',
  chunk_size INTEGER DEFAULT 1000,
  chunk_overlap INTEGER DEFAULT 200,
  top_k INTEGER DEFAULT 5,
  similarity_threshold NUMERIC DEFAULT 0.7,
  enable_reranking BOOLEAN DEFAULT false,
  reranking_model TEXT,
  context_window INTEGER DEFAULT 8000,
  
  -- Chat model configuration
  chat_model TEXT DEFAULT 'gpt-4o-mini',
  temperature NUMERIC DEFAULT 0.7,
  custom_system_prompt TEXT,
  
  -- PII/Privacy settings
  enable_pii_sanitization BOOLEAN DEFAULT true,
  redact_ssn BOOLEAN DEFAULT true,
  redact_dob BOOLEAN DEFAULT true,
  redact_account_numbers BOOLEAN DEFAULT true,
  allow_employee_names BOOLEAN DEFAULT false,
  log_ai_interactions BOOLEAN DEFAULT true,
  
  -- API Keys (encrypted - prefer Secrets Manager in production)
  openai_api_key TEXT,
  gemini_api_key TEXT,
  anthropic_api_key TEXT,
  
  -- Voice Agentic settings
  voice_agentic_enabled BOOLEAN DEFAULT false,
  voice_model TEXT DEFAULT 'gpt-4o-mini',
  voice_name TEXT DEFAULT 'Aria',
  voice_top_k INTEGER DEFAULT 3,
  voice_similarity_threshold NUMERIC DEFAULT 0.75,
  voice_context_window INTEGER DEFAULT 4000,
  voice_temperature NUMERIC DEFAULT 0.8,
  voice_response_max_length INTEGER DEFAULT 60,
  voice_conversation_memory INTEGER DEFAULT 10,
  voice_rag_enabled BOOLEAN DEFAULT true,
  voice_system_prompt TEXT,
  voice_enable_reranking BOOLEAN DEFAULT false,
  voice_real_time_mode BOOLEAN DEFAULT false,
  
  -- Personality/Conversation settings
  allowed_topics TEXT,
  conversation_rules TEXT,
  personality_tone TEXT DEFAULT 'professional',
  personality_style TEXT DEFAULT 'concise',
  personality_custom TEXT,
  knowledge_base_links TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- RAG_DOCUMENT_SOURCES - Document source configuration
-- =============================================================================
CREATE TABLE IF NOT EXISTS rag_document_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('upload', 's3', 'sharepoint', 'confluence', 'url', 'api')),
  source_config JSONB NOT NULL DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'indexing', 'active', 'error', 'paused')),
  document_count INTEGER DEFAULT 0,
  total_chunks INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  last_sync_at TIMESTAMPTZ,
  sync_frequency TEXT DEFAULT 'daily' CHECK (sync_frequency IN ('realtime', 'hourly', 'daily', 'weekly', 'manual')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_document_sources_status ON rag_document_sources(status);
CREATE INDEX IF NOT EXISTS idx_rag_document_sources_type ON rag_document_sources(source_type);

-- =============================================================================
-- RAG_DOCUMENTS - Individual document tracking
-- =============================================================================
CREATE TABLE IF NOT EXISTS rag_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES rag_document_sources(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_path TEXT,
  file_type TEXT,
  file_size_bytes INTEGER,
  file_hash TEXT,
  chunk_count INTEGER DEFAULT 0,
  token_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'indexed', 'error', 'deleted')),
  error_message TEXT,
  indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_documents_source ON rag_documents(source_id);
CREATE INDEX IF NOT EXISTS idx_rag_documents_status ON rag_documents(status);
CREATE INDEX IF NOT EXISTS idx_rag_documents_hash ON rag_documents(file_hash) WHERE file_hash IS NOT NULL;

-- =============================================================================
-- RAG_KNOWLEDGE_BASE - Admin-managed knowledge entries
-- =============================================================================
CREATE TABLE IF NOT EXISTS rag_knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  tags TEXT[],
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_knowledge_base_active ON rag_knowledge_base(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_rag_knowledge_base_category ON rag_knowledge_base(category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rag_knowledge_base_tags ON rag_knowledge_base USING GIN(tags);

-- =============================================================================
-- SAVED_VISUALIZATIONS - Custom dashboard visualizations
-- =============================================================================
CREATE TABLE IF NOT EXISTS saved_visualizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  question TEXT NOT NULL,
  visualization_type TEXT NOT NULL,
  visualization_config JSONB NOT NULL,
  query_config JSONB NOT NULL,
  data_snapshot JSONB,
  position INTEGER DEFAULT 0,
  width INTEGER DEFAULT 1,
  height INTEGER DEFAULT 1,
  is_pinned BOOLEAN DEFAULT false,
  refresh_interval INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_visualizations_user_id ON saved_visualizations(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_visualizations_position ON saved_visualizations(position);

-- =============================================================================
-- CHAT_HISTORY - Data chat session history
-- =============================================================================
CREATE TABLE IF NOT EXISTS chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  visualization_id UUID REFERENCES saved_visualizations(id) ON DELETE SET NULL,
  tokens_used INTEGER,
  model_used TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_history_user_id ON chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_session_id ON chat_history(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_created_at ON chat_history(created_at DESC);

-- =============================================================================
-- TRIGGERS
-- =============================================================================
DROP TRIGGER IF EXISTS trigger_rag_settings_updated_at ON rag_settings;
CREATE TRIGGER trigger_rag_settings_updated_at
  BEFORE UPDATE ON rag_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_rag_document_sources_updated_at ON rag_document_sources;
CREATE TRIGGER trigger_rag_document_sources_updated_at
  BEFORE UPDATE ON rag_document_sources
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_rag_documents_updated_at ON rag_documents;
CREATE TRIGGER trigger_rag_documents_updated_at
  BEFORE UPDATE ON rag_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_rag_knowledge_base_updated_at ON rag_knowledge_base;
CREATE TRIGGER trigger_rag_knowledge_base_updated_at
  BEFORE UPDATE ON rag_knowledge_base
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_saved_visualizations_updated_at ON saved_visualizations;
CREATE TRIGGER trigger_saved_visualizations_updated_at
  BEFORE UPDATE ON saved_visualizations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
