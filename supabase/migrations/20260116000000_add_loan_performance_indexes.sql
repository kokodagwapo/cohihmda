-- Add performance indexes for loans table to optimize imports and queries
-- These indexes significantly improve:
-- 1. Bulk duplicate checking during imports
-- 2. Dashboard queries filtering by tenant + status
-- 3. Leaderboard queries by loan officer
-- 4. Date range queries for analytics

-- Core indexes (may already exist from previous migrations)
CREATE INDEX IF NOT EXISTS idx_loans_tenant ON public.loans(tenant_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON public.loans(status);
CREATE INDEX IF NOT EXISTS idx_loans_created_at ON public.loans(created_at DESC);

-- Composite index for tenant + loan_id lookups (critical for import performance)
-- This speeds up the bulk EXISTS check: WHERE tenant_id = $1 AND loan_id = ANY($2)
CREATE INDEX IF NOT EXISTS idx_loans_tenant_loan_id ON public.loans(tenant_id, loan_id);

-- Partial index for loan officer queries (excludes NULL values to save space)
CREATE INDEX IF NOT EXISTS idx_loans_loan_officer ON public.loans(loan_officer_id) WHERE loan_officer_id IS NOT NULL;

-- Date indexes for common dashboard queries
CREATE INDEX IF NOT EXISTS idx_loans_application_date ON public.loans(application_date DESC);
CREATE INDEX IF NOT EXISTS idx_loans_closing_date ON public.loans(closing_date DESC) WHERE closing_date IS NOT NULL;

-- Composite index for tenant + status (used in dashboard filters and counts)
CREATE INDEX IF NOT EXISTS idx_loans_tenant_status ON public.loans(tenant_id, status);

-- Optional: Add statistics target for better query planning on frequently queried columns
ALTER TABLE public.loans ALTER COLUMN tenant_id SET STATISTICS 1000;
ALTER TABLE public.loans ALTER COLUMN status SET STATISTICS 1000;
ALTER TABLE public.loans ALTER COLUMN loan_id SET STATISTICS 1000;

COMMENT ON INDEX idx_loans_tenant_loan_id IS 'Optimizes bulk import duplicate checking';
COMMENT ON INDEX idx_loans_tenant_status IS 'Optimizes dashboard status filters';
