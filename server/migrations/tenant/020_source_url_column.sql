-- Migration: Add source_url to rag_documents
-- Created: 2026-02-03
-- Database: tenant
--
-- Adds source_url column for storing the original source link of documents

-- Add source_url column to store the original source link
ALTER TABLE rag_documents 
  ADD COLUMN IF NOT EXISTS source_url TEXT;

-- Comment
COMMENT ON COLUMN rag_documents.source_url IS 'URL to the original source of this document (synced from global knowledge library for global docs)';
