-- Create public.users table (for Express backend, separate from auth.users)
-- This table is used by the Express backend for authentication
-- It's separate from Supabase's auth.users table

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  encrypted_password TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON public.users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);

-- Insert default admin user if not exists
INSERT INTO public.users (email, encrypted_password, full_name, role)
VALUES (
  'admin@ailethia.com',
  '$2a$10$YourHashedPasswordHere',  -- This will be replaced with actual hash
  'System Administrator',
  'super_admin'
)
ON CONFLICT (email) DO NOTHING;

-- Create default tenant if not exists
INSERT INTO public.tenants (name)
VALUES ('Default Tenant')
ON CONFLICT DO NOTHING;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO ailethia_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ailethia_admin;
