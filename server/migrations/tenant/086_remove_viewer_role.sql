-- Migration 086: remove legacy viewer tenant role
-- Canonical model:
--   role: tenant_admin | user
--   persona: tenant_admin | tenant_user | tenant_canvas_only_user
--   loan_scope: all | encompass | manual | none

-- Convert any remaining legacy viewer users to canonical canvas-only users.
UPDATE public.users
SET
  role = 'user',
  persona = 'tenant_canvas_only_user',
  loan_scope = 'none',
  access_mode = 'canvas_only',
  loan_access_mode = 'no_access',
  updated_at = NOW()
WHERE role = 'viewer';

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('tenant_admin', 'user'));

-- Keep helper functions aligned with canonical persona/loan_scope behavior.
CREATE OR REPLACE FUNCTION check_user_loan_access(
  p_user_id UUID,
  p_loan_guid TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_role TEXT;
  v_persona TEXT;
  v_scope TEXT;
BEGIN
  SELECT
    role,
    COALESCE(persona, CASE WHEN role = 'tenant_admin' THEN 'tenant_admin' ELSE 'tenant_user' END),
    COALESCE(loan_scope, CASE WHEN role = 'tenant_admin' THEN 'all' ELSE 'encompass' END)
  INTO v_role, v_persona, v_scope
  FROM public.users
  WHERE id = p_user_id AND is_active = true;

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_role = 'tenant_admin' OR v_persona = 'tenant_admin' THEN
    RETURN TRUE;
  END IF;

  CASE v_scope
    WHEN 'all' THEN
      RETURN TRUE;
    WHEN 'none' THEN
      RETURN FALSE;
    ELSE
      RETURN EXISTS (
        SELECT 1
        FROM public.user_loan_access
        WHERE user_id = p_user_id AND loan_guid = p_loan_guid
      );
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_loan_access_mode(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_role TEXT;
  v_persona TEXT;
  v_scope TEXT;
BEGIN
  SELECT
    role,
    COALESCE(persona, CASE WHEN role = 'tenant_admin' THEN 'tenant_admin' ELSE 'tenant_user' END),
    COALESCE(loan_scope, CASE WHEN role = 'tenant_admin' THEN 'all' ELSE 'encompass' END)
  INTO v_role, v_persona, v_scope
  FROM public.users
  WHERE id = p_user_id AND is_active = true;

  IF v_role IS NULL THEN
    RETURN 'no_access';
  END IF;

  IF v_role = 'tenant_admin' OR v_persona = 'tenant_admin' THEN
    RETURN 'full_access';
  END IF;

  CASE v_scope
    WHEN 'all' THEN
      RETURN 'full_access';
    WHEN 'manual' THEN
      RETURN 'manual';
    WHEN 'none' THEN
      RETURN 'no_access';
    ELSE
      RETURN 'encompass_sync';
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
