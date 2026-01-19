-- Fix security warnings by setting search_path on functions

-- Update handle_updated_at function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Update handle_new_user function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  default_tenant_id UUID;
BEGIN
  -- Create a default tenant for the user
  INSERT INTO public.tenants (name)
  VALUES ('Demo Tenant')
  RETURNING id INTO default_tenant_id;

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