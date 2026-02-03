-- Migration: Global Knowledge Library
-- Created: 2026-02-01
-- Database: management
--
-- Creates tables for the global knowledge center that syncs to all tenants:
-- - global_knowledge_library (source of truth for platform-wide docs)
-- - global_knowledge_embeddings (vector embeddings for global docs)
-- - global_knowledge_sync_log (audit trail for sync operations)

-- =============================================================================
-- Enable pgvector extension if not already enabled
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- GLOBAL_KNOWLEDGE_LIBRARY - Source of truth for platform-wide documents
-- =============================================================================
CREATE TABLE IF NOT EXISTS global_knowledge_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Document metadata
  title TEXT NOT NULL,
  filename TEXT,
  file_type TEXT,
  file_size_bytes INTEGER,
  content TEXT,
  category TEXT NOT NULL,
  tags TEXT[],
  
  -- Versioning
  version INTEGER DEFAULT 1,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  
  -- Audit - Creation/Update
  created_by UUID REFERENCES coheus_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES coheus_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Audit - Publishing
  published_by UUID REFERENCES coheus_users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  
  -- Audit - Archiving (soft delete)
  archived_by UUID REFERENCES coheus_users(id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  
  -- Processing status
  chunk_count INTEGER DEFAULT 0,
  token_count INTEGER DEFAULT 0,
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'error')),
  processing_error TEXT
);

-- Indexes for global_knowledge_library
CREATE INDEX IF NOT EXISTS idx_global_knowledge_status ON global_knowledge_library(status);
CREATE INDEX IF NOT EXISTS idx_global_knowledge_category ON global_knowledge_library(category);
CREATE INDEX IF NOT EXISTS idx_global_knowledge_published ON global_knowledge_library(published_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_global_knowledge_tags ON global_knowledge_library USING GIN(tags);

-- =============================================================================
-- GLOBAL_KNOWLEDGE_EMBEDDINGS - Vector embeddings for global documents
-- =============================================================================
CREATE TABLE IF NOT EXISTS global_knowledge_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES global_knowledge_library(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding vector(3072),  -- OpenAI text-embedding-3-large dimensions
  token_count INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure unique chunk per document
  UNIQUE(document_id, chunk_index)
);

-- Indexes for global_knowledge_embeddings
CREATE INDEX IF NOT EXISTS idx_global_embeddings_document ON global_knowledge_embeddings(document_id);

-- IVFFlat index for faster vector similarity search (create after data is loaded)
-- Note: This index should be created manually after initial data load for better performance
-- CREATE INDEX idx_global_embeddings_vector ON global_knowledge_embeddings 
--   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- =============================================================================
-- GLOBAL_KNOWLEDGE_SYNC_LOG - Audit trail for sync operations
-- =============================================================================
CREATE TABLE IF NOT EXISTS global_knowledge_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES global_knowledge_library(id) ON DELETE CASCADE,
  document_version INTEGER NOT NULL,
  tenant_id UUID NOT NULL REFERENCES coheus_tenants(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('sync', 'update', 'delete')),
  status TEXT DEFAULT 'success' CHECK (status IN ('success', 'failed', 'pending')),
  error_message TEXT,
  chunks_synced INTEGER DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  synced_by UUID REFERENCES coheus_users(id) ON DELETE SET NULL
);

-- Indexes for sync_log
CREATE INDEX IF NOT EXISTS idx_sync_log_document ON global_knowledge_sync_log(document_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_tenant ON global_knowledge_sync_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_date ON global_knowledge_sync_log(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_log_status ON global_knowledge_sync_log(status) WHERE status = 'failed';

-- =============================================================================
-- GLOBAL_KNOWLEDGE_CATEGORIES - Predefined categories for organization
-- =============================================================================
CREATE TABLE IF NOT EXISTS global_knowledge_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default categories
INSERT INTO global_knowledge_categories (name, description, icon, sort_order) VALUES
  ('Regulations', 'Federal and state mortgage regulations', 'scale', 1),
  ('Guidelines', 'Loan program guidelines and requirements', 'book-open', 2),
  ('Compliance', 'Compliance requirements and procedures', 'shield-check', 3),
  ('Products', 'Loan product information and specifications', 'package', 4),
  ('Training', 'Training materials and documentation', 'graduation-cap', 5),
  ('Market Intel', 'Market trends and industry news', 'trending-up', 6),
  ('Best Practices', 'Industry best practices and tips', 'lightbulb', 7),
  ('Policy', 'Internal policies and procedures', 'file-text', 8)
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- TRIGGERS - Auto-update timestamps
-- =============================================================================

-- Create or replace the update_updated_at function if not exists
CREATE OR REPLACE FUNCTION update_management_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for global_knowledge_library
DROP TRIGGER IF EXISTS trigger_global_knowledge_library_updated_at ON global_knowledge_library;
CREATE TRIGGER trigger_global_knowledge_library_updated_at
  BEFORE UPDATE ON global_knowledge_library
  FOR EACH ROW
  EXECUTE FUNCTION update_management_updated_at();

-- Trigger for global_knowledge_categories
DROP TRIGGER IF EXISTS trigger_global_knowledge_categories_updated_at ON global_knowledge_categories;
CREATE TRIGGER trigger_global_knowledge_categories_updated_at
  BEFORE UPDATE ON global_knowledge_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_management_updated_at();

-- =============================================================================
-- VERSION HISTORY FUNCTION - Auto-increment version on content change
-- =============================================================================
CREATE OR REPLACE FUNCTION increment_global_knowledge_version()
RETURNS TRIGGER AS $$
BEGIN
  -- Only increment version if content changed and status is being set to published
  IF NEW.content IS DISTINCT FROM OLD.content AND NEW.status = 'published' THEN
    NEW.version = OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_global_knowledge_version ON global_knowledge_library;
CREATE TRIGGER trigger_global_knowledge_version
  BEFORE UPDATE ON global_knowledge_library
  FOR EACH ROW
  EXECUTE FUNCTION increment_global_knowledge_version();

-- =============================================================================
-- COMMENTS
-- =============================================================================
COMMENT ON TABLE global_knowledge_library IS 'Source of truth for platform-wide documents that sync to all tenant databases';
COMMENT ON TABLE global_knowledge_embeddings IS 'Vector embeddings for global documents, used as source for tenant sync';
COMMENT ON TABLE global_knowledge_sync_log IS 'Audit trail tracking all sync operations to tenant databases';
COMMENT ON TABLE global_knowledge_categories IS 'Predefined categories for organizing global knowledge documents';

COMMENT ON COLUMN global_knowledge_library.status IS 'Document lifecycle: draft (not visible), published (synced to tenants), archived (soft deleted)';
COMMENT ON COLUMN global_knowledge_library.version IS 'Auto-incremented when content changes and document is published';
COMMENT ON COLUMN global_knowledge_sync_log.action IS 'sync = new document, update = content change, delete = archived/removed';
