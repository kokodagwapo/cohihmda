-- Migration: Knowledge Sync Support
-- Created: 2026-02-01
-- Database: tenant
--
-- Adds support for syncing global knowledge from the management database:
-- - Adds columns to rag_documents to track global vs tenant-owned docs
-- - Creates knowledge_updates table for tenant admin notification feed
-- - Creates rag_embeddings table if not exists (for vector search)

-- =============================================================================
-- Enable pgvector extension if not already enabled
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- RAG_DOCUMENTS - Add columns to track global vs tenant-owned documents
-- =============================================================================

-- Add is_global flag to distinguish synced global docs from tenant-owned
ALTER TABLE rag_documents 
  ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT false;

-- Add global_doc_id to link back to the source document in management DB
ALTER TABLE rag_documents 
  ADD COLUMN IF NOT EXISTS global_doc_id UUID;

-- Add global_version to track which version of the global doc is synced
ALTER TABLE rag_documents 
  ADD COLUMN IF NOT EXISTS global_version INTEGER;

-- Add content column if not exists (for storing document text)
ALTER TABLE rag_documents 
  ADD COLUMN IF NOT EXISTS content TEXT;

-- Add title column if not exists
ALTER TABLE rag_documents 
  ADD COLUMN IF NOT EXISTS title TEXT;

-- Add category column if not exists
ALTER TABLE rag_documents 
  ADD COLUMN IF NOT EXISTS category TEXT;

-- Add tags column if not exists
ALTER TABLE rag_documents 
  ADD COLUMN IF NOT EXISTS tags TEXT[];

-- Index for quickly finding global documents
CREATE INDEX IF NOT EXISTS idx_rag_documents_is_global ON rag_documents(is_global) WHERE is_global = true;

-- Index for looking up by global_doc_id
CREATE INDEX IF NOT EXISTS idx_rag_documents_global_doc_id ON rag_documents(global_doc_id) WHERE global_doc_id IS NOT NULL;

-- Unique constraint to prevent duplicate syncs of the same global doc
CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_documents_global_unique 
  ON rag_documents(global_doc_id) WHERE is_global = true AND global_doc_id IS NOT NULL;

-- =============================================================================
-- RAG_EMBEDDINGS - Vector embeddings for document chunks
-- =============================================================================
CREATE TABLE IF NOT EXISTS rag_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding vector(3072),  -- OpenAI text-embedding-3-large dimensions
  token_count INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure unique chunk per document
  UNIQUE(document_id, chunk_index)
);

-- Index for document lookup
CREATE INDEX IF NOT EXISTS idx_rag_embeddings_document ON rag_embeddings(document_id);

-- =============================================================================
-- KNOWLEDGE_UPDATES - Tenant admin notification feed for global doc changes
-- =============================================================================
CREATE TABLE IF NOT EXISTS knowledge_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reference to the global document
  global_doc_id UUID NOT NULL,
  
  -- Document info (cached for display even if doc is later deleted)
  title TEXT NOT NULL,
  category TEXT,
  
  -- What happened
  action TEXT NOT NULL CHECK (action IN ('added', 'updated', 'removed')),
  version INTEGER,
  change_summary TEXT,
  
  -- When it was synced to this tenant
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Acknowledgment tracking
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ
);

-- Index for showing recent updates
CREATE INDEX IF NOT EXISTS idx_knowledge_updates_date ON knowledge_updates(synced_at DESC);

-- Index for finding unacknowledged updates
CREATE INDEX IF NOT EXISTS idx_knowledge_updates_unread ON knowledge_updates(acknowledged_at) WHERE acknowledged_at IS NULL;

-- Index for looking up by global_doc_id
CREATE INDEX IF NOT EXISTS idx_knowledge_updates_global_doc ON knowledge_updates(global_doc_id);

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Trigger for rag_embeddings updated_at (if the column exists)
-- Note: rag_embeddings doesn't have updated_at, but if we add it later:
-- DROP TRIGGER IF EXISTS trigger_rag_embeddings_updated_at ON rag_embeddings;
-- CREATE TRIGGER trigger_rag_embeddings_updated_at
--   BEFORE UPDATE ON rag_embeddings
--   FOR EACH ROW
--   EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Function to get count of unread knowledge updates
CREATE OR REPLACE FUNCTION get_unread_knowledge_updates_count()
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER 
  FROM knowledge_updates 
  WHERE acknowledged_at IS NULL;
$$ LANGUAGE sql STABLE;

-- Function to acknowledge all updates for a user
CREATE OR REPLACE FUNCTION acknowledge_all_knowledge_updates(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE knowledge_updates 
  SET acknowledged_by = p_user_id, 
      acknowledged_at = NOW()
  WHERE acknowledged_at IS NULL;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- COMMENTS
-- =============================================================================
COMMENT ON COLUMN rag_documents.is_global IS 'True if this document was synced from the global knowledge library';
COMMENT ON COLUMN rag_documents.global_doc_id IS 'UUID of the source document in the management DB global_knowledge_library table';
COMMENT ON COLUMN rag_documents.global_version IS 'Version number of the global document that is currently synced';

COMMENT ON TABLE knowledge_updates IS 'Feed of global knowledge changes for tenant admins to review';
COMMENT ON COLUMN knowledge_updates.action IS 'added = new doc synced, updated = content changed, removed = doc archived';
COMMENT ON COLUMN knowledge_updates.acknowledged_by IS 'User who acknowledged/dismissed this update';

COMMENT ON TABLE rag_embeddings IS 'Vector embeddings for document chunks, used for semantic search';
