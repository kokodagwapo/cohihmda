-- Create AWS Billing History table for per-lender AWS hosting costs
CREATE TABLE IF NOT EXISTS public.aws_billing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  billing_period_start DATE NOT NULL,
  billing_period_end DATE NOT NULL,
  total_cost DECIMAL(10, 2) NOT NULL,
  breakdown JSONB DEFAULT '{}', -- { "ec2": 50.00, "rds": 30.00, "s3": 5.00, ... }
  aws_account_id TEXT,
  invoice_id TEXT,
  payment_status TEXT DEFAULT 'pending', -- pending, paid, overdue
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_aws_billing_tenant ON public.aws_billing_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_aws_billing_period ON public.aws_billing_history(billing_period_start, billing_period_end);
CREATE INDEX IF NOT EXISTS idx_aws_billing_status ON public.aws_billing_history(payment_status);

-- Add comment
COMMENT ON TABLE public.aws_billing_history IS 'AWS hosting billing history for per-lender deployments';
