-- Loan outcome embeddings for retrieval-augmented prediction (RAG)
-- Migration Date: 2026-01-26
-- Description: Vector embeddings of canonical loan representations for similarity search.
--   Historical loans are embedded once; active loans are embedded at prediction time and
--   compared to historical embeddings to retrieve top-K similar loans before GPT inference.

-- pgvector is required; create if not exists (Supabase/Postgres may already have it)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.loan_outcome_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  loan_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('withdraw', 'deny', 'originate')),
  canonical_text TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, loan_id)
);

CREATE INDEX IF NOT EXISTS idx_loan_outcome_embeddings_tenant ON public.loan_outcome_embeddings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_loan_outcome_embeddings_tenant_loan ON public.loan_outcome_embeddings(tenant_id, loan_id);

-- Cosine similarity search (optional; improves performance for large tables)
-- CREATE INDEX IF NOT EXISTS idx_loan_outcome_embeddings_embedding
--   ON public.loan_outcome_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

COMMENT ON TABLE public.loan_outcome_embeddings IS 'Vector embeddings of canonical loan representations for RAG-style outcome prediction. One row per historical loan per tenant.';
COMMENT ON COLUMN public.loan_outcome_embeddings.outcome IS 'Actual outcome: withdraw, deny, or originate';
COMMENT ON COLUMN public.loan_outcome_embeddings.canonical_text IS 'Deterministic text used to generate the embedding (signal strengths only)';
COMMENT ON COLUMN public.loan_outcome_embeddings.embedding IS 'OpenAI text-embedding-3-small dimension 1536; use same model for query embeddings';
