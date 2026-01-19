-- Loans and Employees Tables for Dashboard Data
-- Migration Date: 2025-12-26
-- Description: Tables for storing loan and employee data imported from CSV or LOS systems

-- Loans table
CREATE TABLE IF NOT EXISTS public.loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  loan_id TEXT,
  loan_amount DECIMAL(15,2),
  status TEXT CHECK (status IN ('inquiry', 'started', 'locked', 'funded', 'denied', 'withdrawn')),
  loan_officer_id UUID,
  branch TEXT,
  loan_type TEXT,
  loan_purpose TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  cycle_time_days INTEGER,
  credit_pull_date TIMESTAMPTZ,
  lock_date TIMESTAMPTZ,
  fund_date TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loans_tenant ON public.loans(tenant_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON public.loans(status);
CREATE INDEX IF NOT EXISTS idx_loans_created_at ON public.loans(created_at);
CREATE INDEX IF NOT EXISTS idx_loans_loan_officer ON public.loans(loan_officer_id) WHERE loan_officer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loans_loan_id ON public.loans(tenant_id, loan_id) WHERE loan_id IS NOT NULL;

COMMENT ON TABLE public.loans IS 'Loan records imported from CSV or LOS systems';
COMMENT ON COLUMN public.loans.loan_id IS 'External loan identifier from LOS';
COMMENT ON COLUMN public.loans.status IS 'Current status in the loan pipeline';

-- Employees table
CREATE TABLE IF NOT EXISTS public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  role TEXT,
  branch TEXT,
  employee_id TEXT,
  hire_date DATE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_employees_tenant ON public.employees(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON public.employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_role ON public.employees(role) WHERE role IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_branch ON public.employees(branch) WHERE branch IS NOT NULL;

COMMENT ON TABLE public.employees IS 'Employee records imported from CSV or HR systems';
COMMENT ON COLUMN public.employees.employee_id IS 'External employee identifier';

-- Add foreign key relationship between loans and employees
ALTER TABLE public.loans 
  ADD CONSTRAINT fk_loans_employee 
  FOREIGN KEY (loan_officer_id) 
  REFERENCES public.employees(id) 
  ON DELETE SET NULL;

-- Trigger for updated_at
CREATE TRIGGER update_loans_updated_at BEFORE UPDATE ON public.loans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

