-- Add API key fields to tenant_rag_settings
-- Migration Date: 2025-12-28
-- Description: Add OpenAI and Gemini API key fields for RAG configuration

-- Add API key columns (stored as encrypted text)
ALTER TABLE public.tenant_rag_settings
  ADD COLUMN IF NOT EXISTS openai_api_key TEXT,
  ADD COLUMN IF NOT EXISTS gemini_api_key TEXT;

-- Add comments
COMMENT ON COLUMN public.tenant_rag_settings.openai_api_key IS 'OpenAI API key for embeddings and chat models (encrypted at application level)';
COMMENT ON COLUMN public.tenant_rag_settings.gemini_api_key IS 'Google Gemini API key for voice agentic models (encrypted at application level)';

-- Note: In production, these keys should be encrypted using application-level encryption
-- before being stored in the database. The encryption/decryption should happen
-- in the backend API routes, not in the database layer.
