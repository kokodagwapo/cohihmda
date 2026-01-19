-- Create users table for Amazon RDS (standalone, no Supabase auth)
-- This replaces the dependency on auth.users

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer')),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON public.users(tenant_id);

-- Create trigger for updated_at
CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Update profiles table to reference public.users instead of auth.users
-- First, drop the old foreign key constraint if it exists
ALTER TABLE public.profiles 
  DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;

-- Add new foreign key constraint to public.users
ALTER TABLE public.profiles 
  ADD CONSTRAINT profiles_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- Create default admin user (password: admin123)
-- Password hash for 'admin123' using bcryptjs (10 rounds)
INSERT INTO public.users (email, password_hash, full_name, role, is_active)
VALUES (
  'admin@ailethia.com',
  '$2a$10$vbbt8TWzAGU1Nf5QPom4bu9rxKx.8QqK/COn1HScKq3TysCmYJFlK',  -- admin123
  'Admin User',
  'admin',
  true
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active;

-- Create default tenant for admin
DO $$
DECLARE
  admin_user_id UUID;
  default_tenant_id UUID;
BEGIN
  -- Get admin user ID
  SELECT id INTO admin_user_id FROM public.users WHERE email = 'admin@ailethia.com';
  
  -- Create or get default tenant
  INSERT INTO public.tenants (name)
  VALUES ('Ailethia Admin')
  ON CONFLICT DO NOTHING
  RETURNING id INTO default_tenant_id;
  
  -- If tenant already exists, get its ID
  IF default_tenant_id IS NULL THEN
    SELECT id INTO default_tenant_id FROM public.tenants LIMIT 1;
  END IF;
  
  -- Update admin user with tenant
  UPDATE public.users 
  SET tenant_id = default_tenant_id 
  WHERE id = admin_user_id;
  
  -- Create or update profile for admin
  INSERT INTO public.profiles (user_id, tenant_id, full_name, email)
  VALUES (admin_user_id, default_tenant_id, 'Admin User', 'admin@ailethia.com')
  ON CONFLICT (user_id) DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id,
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email;
END $$;

-- Drop RLS policies that reference auth.uid() since we're not using Supabase auth
-- We'll implement JWT-based authentication in the backend instead
ALTER TABLE public.tenants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_turns DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_results DISABLE ROW LEVEL SECURITY;

-- Note: Row-level security will be handled in the application layer (backend API)
-- using JWT tokens and tenant_id filtering
