-- =============================================================================
-- Migration 036: Create tenant_calculations table and seed default formula
-- =============================================================================
-- Stores custom calculation formulas per tenant (e.g. revenue formula).
-- Previously only created by tenantDatabaseSchema.ts at runtime.

CREATE TABLE IF NOT EXISTS public.tenant_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calculation_type VARCHAR(50) NOT NULL DEFAULT 'revenue',
  name VARCHAR(100) NOT NULL,
  description TEXT,
  formula_components JSONB NOT NULL DEFAULT '[]',
  sql_expression TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  is_validated BOOLEAN DEFAULT FALSE,
  last_validated_at TIMESTAMPTZ,
  validation_result TEXT,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES public.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(calculation_type, name)
);

CREATE INDEX IF NOT EXISTS idx_tenant_calculations_type
  ON public.tenant_calculations(calculation_type);

CREATE INDEX IF NOT EXISTS idx_tenant_calculations_active
  ON public.tenant_calculations(calculation_type, is_active) WHERE is_active = TRUE;

-- Seed default revenue calculation (matches current production formula)
INSERT INTO public.tenant_calculations (
  calculation_type, name, description, formula_components, sql_expression, is_active, is_validated
)
VALUES (
  'revenue',
  'Default Revenue Formula',
  'Standard revenue calculation: Base Buy ($) + Orig Fee Borr Pd + Orig Fees Seller - CD Lender Credits. Base Buy = ((rate_lock_buy_side_base_price_rate - 100) / 100) * loan_amount',
  '[
    {"field": "rate_lock_buy_side_base_price_rate", "operator": "+", "is_base_buy": true, "label": "Base Buy ($)"},
    {"field": "orig_fee_borr_pd", "operator": "+", "label": "Orig Fee Borr Pd"},
    {"field": "orig_fees_seller", "operator": "+", "label": "Orig Fees Seller"},
    {"field": "cd_lender_credits", "operator": "-", "label": "CD Lender Credits"}
  ]'::jsonb,
  'COALESCE(CASE WHEN rate_lock_buy_side_base_price_rate IS NOT NULL AND rate_lock_buy_side_base_price_rate != 0 THEN ROUND(((rate_lock_buy_side_base_price_rate - 100.0) / 100.0) * loan_amount, 2) ELSE 0 END, 0) + COALESCE(orig_fee_borr_pd, 0) + COALESCE(orig_fees_seller, 0) - COALESCE(cd_lender_credits, 0)',
  TRUE,
  TRUE
)
ON CONFLICT (calculation_type, name) DO NOTHING;
