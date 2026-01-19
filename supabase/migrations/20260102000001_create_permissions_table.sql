-- Create permissions table for RBAC
-- Migration Date: 2026-01-02
-- Description: RBAC permissions matrix for fine-grained access control

CREATE TABLE IF NOT EXISTS public.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(role, resource, action)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_permissions_role_resource ON public.permissions(role, resource);
CREATE INDEX IF NOT EXISTS idx_permissions_role ON public.permissions(role);

-- Insert default permissions
INSERT INTO public.permissions (role, resource, action) VALUES
  -- Super admin has all permissions (handled in code, but add for completeness)
  ('super_admin', '*', '*'),
  
  -- Tenant admin permissions
  ('tenant_admin', 'users', 'read'),
  ('tenant_admin', 'users', 'create'),
  ('tenant_admin', 'users', 'update'),
  ('tenant_admin', 'users', 'delete'),
  ('tenant_admin', 'tenants', 'read'),
  ('tenant_admin', 'tenants', 'update'),
  ('tenant_admin', 'loans', 'read'),
  ('tenant_admin', 'loans', 'create'),
  ('tenant_admin', 'loans', 'update'),
  ('tenant_admin', 'loans', 'delete'),
  ('tenant_admin', 'contacts', 'read'),
  ('tenant_admin', 'contacts', 'create'),
  ('tenant_admin', 'contacts', 'update'),
  ('tenant_admin', 'contacts', 'delete'),
  ('tenant_admin', 'calls', 'read'),
  ('tenant_admin', 'calls', 'create'),
  ('tenant_admin', 'documents', 'read'),
  ('tenant_admin', 'documents', 'create'),
  
  -- Loan officer permissions
  ('loan_officer', 'loans', 'read'),
  ('loan_officer', 'loans', 'create'),
  ('loan_officer', 'loans', 'update'),
  ('loan_officer', 'contacts', 'read'),
  ('loan_officer', 'contacts', 'create'),
  ('loan_officer', 'calls', 'read'),
  ('loan_officer', 'calls', 'create'),
  ('loan_officer', 'documents', 'read'),
  ('loan_officer', 'documents', 'create'),
  
  -- Processor permissions
  ('processor', 'loans', 'read'),
  ('processor', 'loans', 'update'),
  ('processor', 'documents', 'read'),
  ('processor', 'documents', 'create'),
  ('processor', 'documents', 'update'),
  
  -- Viewer permissions (read-only)
  ('viewer', 'loans', 'read'),
  ('viewer', 'contacts', 'read'),
  ('viewer', 'calls', 'read'),
  ('viewer', 'documents', 'read'),
  ('viewer', 'users', 'read'),
  
  -- Regular user permissions
  ('user', 'loans', 'read'),
  ('user', 'contacts', 'read'),
  ('user', 'calls', 'read')
ON CONFLICT (role, resource, action) DO NOTHING;

COMMENT ON TABLE public.permissions IS 'RBAC permissions matrix defining what actions each role can perform on each resource';
COMMENT ON COLUMN public.permissions.role IS 'User role (super_admin, tenant_admin, loan_officer, processor, viewer, user)';
COMMENT ON COLUMN public.permissions.resource IS 'Resource type (users, tenants, loans, contacts, calls, documents, *)';
COMMENT ON COLUMN public.permissions.action IS 'Action type (read, create, update, delete, *)';
