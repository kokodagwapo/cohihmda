-- Create loan_predictions table for storing AI prediction results
-- Migration Date: 2026-01-24
-- Description: Stores AI-generated loan outcome predictions with confidence scores and reasoning

CREATE TABLE IF NOT EXISTS public.loan_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  loan_id TEXT NOT NULL,
  predicted_outcome TEXT NOT NULL CHECK (predicted_outcome IN ('withdraw', 'deny', 'originate')),
  confidence INTEGER NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  reasoning TEXT,
  risk_factors TEXT[],
  model_version TEXT DEFAULT 'gpt-4o',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, loan_id, created_at)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_loan_predictions_tenant_loan ON public.loan_predictions(tenant_id, loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_predictions_outcome ON public.loan_predictions(predicted_outcome);
CREATE INDEX IF NOT EXISTS idx_loan_predictions_created ON public.loan_predictions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loan_predictions_tenant_created ON public.loan_predictions(tenant_id, created_at DESC);

-- Create trigger for updated_at column (if function exists)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    DROP TRIGGER IF EXISTS update_loan_predictions_updated_at ON public.loan_predictions;
    CREATE TRIGGER update_loan_predictions_updated_at
    BEFORE UPDATE ON public.loan_predictions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

COMMENT ON TABLE public.loan_predictions IS 'Stores AI-generated predictions for loan outcomes (withdraw, deny, originate)';
COMMENT ON COLUMN public.loan_predictions.predicted_outcome IS 'AI-predicted outcome: withdraw, deny, or originate';
COMMENT ON COLUMN public.loan_predictions.confidence IS 'Confidence score from 0-100';
COMMENT ON COLUMN public.loan_predictions.reasoning IS 'AI explanation for the prediction';
COMMENT ON COLUMN public.loan_predictions.risk_factors IS 'Array of risk factors identified by AI';
COMMENT ON COLUMN public.loan_predictions.model_version IS 'AI model version used (e.g., gpt-4o)';
