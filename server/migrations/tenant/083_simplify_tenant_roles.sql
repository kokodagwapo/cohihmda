-- Migration: simplify tenant user roles to tenant_admin, user, viewer
-- Converts legacy roles and constrains future writes.

-- Normalize legacy/admin-like roles to tenant_admin.
UPDATE public.users
SET role = 'tenant_admin'
WHERE role IN ('admin', 'super_admin', 'platform_admin');

-- Normalize role variants that should become standard users.
UPDATE public.users
SET role = 'user'
WHERE role IN ('loan_officer', 'processor', 'support', 'manager');

-- Final safety net: any remaining unknown role becomes user so
-- the new 3-role constraint can be applied reliably.
UPDATE public.users
SET role = 'user'
WHERE role NOT IN ('tenant_admin', 'user', 'viewer');

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('tenant_admin', 'user', 'viewer'));

CREATE OR REPLACE FUNCTION check_user_loan_access(
  p_user_id UUID,
  p_loan_guid TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_access_mode TEXT;
  v_role TEXT;
BEGIN
  SELECT
    COALESCE(loan_access_mode, 'encompass_sync'),
    role
  INTO v_access_mode, v_role
  FROM users
  WHERE id = p_user_id AND is_active = true;

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_role = 'tenant_admin' THEN
    RETURN TRUE;
  END IF;

  CASE v_access_mode
    WHEN 'full_access' THEN
      RETURN TRUE;
    WHEN 'no_access' THEN
      RETURN FALSE;
    ELSE
      RETURN EXISTS (
        SELECT 1 FROM user_loan_access
        WHERE user_id = p_user_id AND loan_guid = p_loan_guid
      );
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_loan_access_mode(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_access_mode TEXT;
  v_role TEXT;
BEGIN
  SELECT
    COALESCE(loan_access_mode, 'encompass_sync'),
    role
  INTO v_access_mode, v_role
  FROM users
  WHERE id = p_user_id AND is_active = true;

  IF v_role IS NULL THEN
    RETURN 'no_access';
  END IF;

  IF v_role = 'tenant_admin' THEN
    RETURN 'full_access';
  END IF;

  IF v_role = 'viewer' THEN
    RETURN 'no_access';
  END IF;

  RETURN v_access_mode;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
