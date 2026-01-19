-- Create subscription plans table
CREATE TABLE public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE, -- 'free', 'pro', 'enterprise'
  display_name TEXT NOT NULL,
  price_monthly DECIMAL(10, 2) NOT NULL DEFAULT 0,
  price_yearly DECIMAL(10, 2),
  stripe_price_id_monthly TEXT,
  stripe_price_id_yearly TEXT,
  features JSONB NOT NULL DEFAULT '{}',
  limits JSONB NOT NULL DEFAULT '{}', -- e.g., {"calls_per_month": 100, "storage_gb": 10}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create subscriptions table
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'trialing', 'incomplete')),
  stripe_subscription_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create usage tracking table
CREATE TABLE public.usage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL, -- 'api_calls', 'storage_bytes', 'calls_count', etc.
  metric_value DECIMAL(15, 2) NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create payment methods table
CREATE TABLE public.payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stripe_payment_method_id TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  type TEXT NOT NULL, -- 'card', 'bank_account'
  last4 TEXT,
  brand TEXT,
  exp_month INTEGER,
  exp_year INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create API keys table for tenant API access
CREATE TABLE public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL, -- First 8 chars for display
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add subscription_id to tenants
ALTER TABLE public.tenants 
ADD COLUMN subscription_id UUID REFERENCES public.subscriptions(id);

-- Enable Row Level Security
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- RLS Policies for subscription_plans (public read)
CREATE POLICY "Anyone can view subscription plans"
  ON public.subscription_plans FOR SELECT
  USING (true);

-- RLS Policies for subscriptions
CREATE POLICY "Users can view their tenant's subscription"
  ON public.subscriptions FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Users can update their tenant's subscription"
  ON public.subscriptions FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

-- RLS Policies for usage_metrics
CREATE POLICY "Users can view their tenant's usage"
  ON public.usage_metrics FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "System can insert usage metrics"
  ON public.usage_metrics FOR INSERT
  WITH CHECK (true);

-- RLS Policies for payment_methods
CREATE POLICY "Users can view their tenant's payment methods"
  ON public.payment_methods FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage their tenant's payment methods"
  ON public.payment_methods FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

-- RLS Policies for api_keys
CREATE POLICY "Users can view their tenant's API keys"
  ON public.api_keys FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage their tenant's API keys"
  ON public.api_keys FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid()));

-- Create triggers for updated_at
CREATE TRIGGER set_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_api_keys_updated_at
  BEFORE UPDATE ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Insert default plans
INSERT INTO public.subscription_plans (name, display_name, price_monthly, price_yearly, features, limits) VALUES
('free', 'Free', 0, 0, 
 '{"calls_per_month": 10, "storage_gb": 1, "support": "community", "api_access": false}'::jsonb,
 '{"calls_per_month": 10, "storage_gb": 1, "max_users": 1}'::jsonb),
('pro', 'Pro', 99, 990,
 '{"calls_per_month": 1000, "storage_gb": 100, "support": "email", "api_access": true}'::jsonb,
 '{"calls_per_month": 1000, "storage_gb": 100, "max_users": 10}'::jsonb),
('enterprise', 'Enterprise', 499, 4990,
 '{"calls_per_month": -1, "storage_gb": 1000, "support": "priority", "api_access": true, "sso": true}'::jsonb,
 '{"calls_per_month": -1, "storage_gb": 1000, "max_users": -1}'::jsonb);

-- Function to check usage limits
CREATE OR REPLACE FUNCTION public.check_usage_limit(
  p_tenant_id UUID,
  p_metric_type TEXT,
  p_limit_value DECIMAL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_usage DECIMAL;
  period_start TIMESTAMPTZ;
BEGIN
  period_start := date_trunc('month', now());
  
  SELECT COALESCE(SUM(metric_value), 0) INTO current_usage
  FROM public.usage_metrics
  WHERE tenant_id = p_tenant_id
    AND metric_type = p_metric_type
    AND period_start >= period_start;
  
  -- -1 means unlimited
  IF p_limit_value = -1 THEN
    RETURN true;
  END IF;
  
  RETURN current_usage < p_limit_value;
END;
$$;

-- Function to record usage
CREATE OR REPLACE FUNCTION public.record_usage(
  p_tenant_id UUID,
  p_metric_type TEXT,
  p_metric_value DECIMAL DEFAULT 1,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  usage_id UUID;
  period_start TIMESTAMPTZ;
  period_end TIMESTAMPTZ;
BEGIN
  period_start := date_trunc('month', now());
  period_end := (period_start + interval '1 month')::timestamptz;
  
  INSERT INTO public.usage_metrics (tenant_id, metric_type, metric_value, period_start, period_end, metadata)
  VALUES (p_tenant_id, p_metric_type, p_metric_value, period_start, period_end, p_metadata)
  RETURNING id INTO usage_id;
  
  RETURN usage_id;
END;
$$;

-- Function to get current usage for a tenant
CREATE OR REPLACE FUNCTION public.get_current_usage(
  p_tenant_id UUID,
  p_metric_type TEXT
)
RETURNS DECIMAL
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_usage DECIMAL;
  period_start TIMESTAMPTZ;
BEGIN
  period_start := date_trunc('month', now());
  
  SELECT COALESCE(SUM(metric_value), 0) INTO current_usage
  FROM public.usage_metrics
  WHERE tenant_id = p_tenant_id
    AND metric_type = p_metric_type
    AND period_start >= period_start;
  
  RETURN current_usage;
END;
$$;

-- Update handle_new_user to create free subscription
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  default_tenant_id UUID;
  free_plan_id UUID;
  new_subscription_id UUID;
BEGIN
  -- Create a default tenant for the user
  INSERT INTO public.tenants (name)
  VALUES ('Demo Tenant')
  RETURNING id INTO default_tenant_id;

  -- Get free plan ID
  SELECT id INTO free_plan_id
  FROM public.subscription_plans
  WHERE name = 'free'
  LIMIT 1;

  -- Create free subscription
  INSERT INTO public.subscriptions (tenant_id, plan_id, status)
  VALUES (default_tenant_id, free_plan_id, 'active')
  RETURNING id INTO new_subscription_id;

  -- Update tenant with subscription
  UPDATE public.tenants
  SET subscription_id = new_subscription_id
  WHERE id = default_tenant_id;

  -- Insert profile for new user
  INSERT INTO public.profiles (user_id, tenant_id, full_name, email)
  VALUES (
    NEW.id,
    default_tenant_id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email
  );

  RETURN NEW;
END;
$$;

