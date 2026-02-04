-- Migration: Add source_url to global_knowledge_library
-- Created: 2026-02-03
-- Database: management
--
-- Adds source_url column for storing the original source link of uploaded documents

-- Add source_url column to store the original source link
ALTER TABLE global_knowledge_library 
  ADD COLUMN IF NOT EXISTS source_url TEXT;

-- Comment
COMMENT ON COLUMN global_knowledge_library.source_url IS 'URL to the original source of this document (e.g., where it was downloaded from)';
