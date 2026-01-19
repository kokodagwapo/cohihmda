-- Migration: AWS Deployments and Enhanced Tenant Subscriptions
-- Date: 2026-01-02
-- Description: Add tables for tracking AWS deployments and enhance tenant_subscriptions

-- ============================================================================
-- AWS DEPLOYMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.aws_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  
  -- AWS Account Information
  aws_account_id VARCHAR(12), -- 12-digit AWS account ID
  stack_id VARCHAR(255), -- CloudFormation stack ID
  stack_instance_id VARCHAR(255), -- StackSet instance ID
  
  -- Status Tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'provisioning', 'active', 'failed', 'deleted')),
  provisioning_status TEXT CHECK (provisioning_status IN ('account_creation', 'stack_deployment', 'admin_setup', 'completed')),
  
  -- Infrastructure URLs
  infrastructure_url TEXT, -- CloudFront URL or main application URL
  admin_url TEXT, -- Admin panel URL
  backend_url TEXT, -- Backend API URL
  database_url TEXT, -- RDS endpoint (internal)
  
  -- Timing
  provisioning_started_at TIMESTAMPTZ,
  provisioning_completed_at TIMESTAMPTZ,
  error_message TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tenant_id),
  UNIQUE(aws_account_id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_aws_deployments_tenant_id ON public.aws_deployments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_aws_deployments_status ON public.aws_deployments(status);
CREATE INDEX IF NOT EXISTS idx_aws_deployments_aws_account_id ON public.aws_deployments(aws_account_id);
CREATE INDEX IF NOT EXISTS idx_aws_deployments_provisioning_status ON public.aws_deployments(provisioning_status);

-- ============================================================================
-- ENHANCE TENANT_SUBSCRIPTIONS TABLE
-- ============================================================================

-- Add AWS account ID and provisioning status columns if they don't exist
DO $$ 
BEGIN
  -- Add aws_account_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'tenant_subscriptions' 
    AND column_name = 'aws_account_id'
  ) THEN
    ALTER TABLE public.tenant_subscriptions 
    ADD COLUMN aws_account_id VARCHAR(12);
  END IF;

  -- Add provisioning_status if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'tenant_subscriptions' 
    AND column_name = 'provisioning_status'
  ) THEN
    ALTER TABLE public.tenant_subscriptions 
    ADD COLUMN provisioning_status TEXT CHECK (provisioning_status IN ('pending', 'in_progress', 'completed', 'failed'));
  END IF;

  -- Add stripe_checkout_session_id for tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'tenant_subscriptions' 
    AND column_name = 'stripe_checkout_session_id'
  ) THEN
    ALTER TABLE public.tenant_subscriptions 
    ADD COLUMN stripe_checkout_session_id TEXT;
  END IF;
END $$;

-- Create index on aws_account_id
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_aws_account_id 
ON public.tenant_subscriptions(aws_account_id);

-- Create index on provisioning_status
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_provisioning_status 
ON public.tenant_subscriptions(provisioning_status);

-- ============================================================================
-- TRIGGER FOR UPDATED_AT
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_aws_deployments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for aws_deployments
DROP TRIGGER IF EXISTS trigger_aws_deployments_updated_at ON public.aws_deployments;
CREATE TRIGGER trigger_aws_deployments_updated_at
  BEFORE UPDATE ON public.aws_deployments
  FOR EACH ROW
  EXECUTE FUNCTION update_aws_deployments_updated_at();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE public.aws_deployments IS 'Tracks AWS infrastructure provisioning for per-lender deployments';
COMMENT ON COLUMN public.aws_deployments.aws_account_id IS '12-digit AWS account ID created via AWS Organizations';
COMMENT ON COLUMN public.aws_deployments.status IS 'Overall deployment status';
COMMENT ON COLUMN public.aws_deployments.provisioning_status IS 'Current step in provisioning process';
COMMENT ON COLUMN public.aws_deployments.infrastructure_url IS 'Main application URL (CloudFront distribution)';
COMMENT ON COLUMN public.aws_deployments.admin_url IS 'Admin panel URL for this lender';
