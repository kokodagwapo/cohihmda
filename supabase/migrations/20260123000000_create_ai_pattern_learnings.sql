-- AI Pattern Learnings Table
-- Stores AI-extracted patterns from historical loan data to avoid re-learning on every prediction
-- Migration Date: 2026-01-23

CREATE TABLE IF NOT EXISTS public.ai_pattern_learnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  learning_type TEXT NOT NULL DEFAULT 'historical_patterns', -- 'historical_patterns', 'signal_patterns', etc.
  pattern_summary TEXT NOT NULL, -- AI-generated summary of patterns learned
  historical_loan_count INTEGER NOT NULL, -- Number of historical loans analyzed
  date_range_start DATE, -- Start date of historical loans analyzed
  date_range_end DATE, -- End date of historical loans analyzed
  model_version TEXT DEFAULT 'gpt-4o', -- AI model used to generate patterns
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ, -- Optional: when this learning should be refreshed
  metadata JSONB DEFAULT '{}' -- Additional metadata (sample loans used, confidence scores, etc.)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_pattern_learnings_tenant ON public.ai_pattern_learnings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_pattern_learnings_type ON public.ai_pattern_learnings(learning_type);
CREATE INDEX IF NOT EXISTS idx_ai_pattern_learnings_active ON public.ai_pattern_learnings(is_active);
CREATE INDEX IF NOT EXISTS idx_ai_pattern_learnings_expires ON public.ai_pattern_learnings(expires_at);

-- Comments
COMMENT ON TABLE public.ai_pattern_learnings IS 'Stores AI-extracted patterns from historical loan data for reuse in predictions';
COMMENT ON COLUMN public.ai_pattern_learnings.pattern_summary IS 'AI-generated summary of patterns learned from historical loans';
COMMENT ON COLUMN public.ai_pattern_learnings.historical_loan_count IS 'Number of historical loans analyzed to generate this learning';
COMMENT ON COLUMN public.ai_pattern_learnings.expires_at IS 'When this learning should be refreshed (e.g., after 30 days)';
