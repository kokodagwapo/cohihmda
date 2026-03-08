-- =============================================================================
-- Migration 085: Canonical tenant user access profile
-- =============================================================================
-- Introduces canonical access fields:
--   - persona: tenant_admin | tenant_user | tenant_canvas_only_user
--   - loan_scope: all | encompass | manual | none
--
-- Legacy columns (role/access_mode/loan_access_mode) are retained for
-- backward compatibility and are backfilled from the canonical values.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS persona TEXT;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS loan_scope TEXT;

-- Backfill persona from existing role/access_mode state
UPDATE public.users
SET persona = CASE
  WHEN role = 'tenant_admin' THEN 'tenant_admin'
  WHEN COALESCE(access_mode, 'full') = 'canvas_only' THEN 'tenant_canvas_only_user'
  ELSE 'tenant_user'
END
WHERE persona IS NULL;

-- Backfill loan_scope from existing role/loan_access_mode state
UPDATE public.users
SET loan_scope = CASE
  WHEN role = 'tenant_admin' THEN 'all'
  WHEN COALESCE(access_mode, 'full') = 'canvas_only' THEN 'none'
  WHEN COALESCE(loan_access_mode, 'encompass_sync') = 'full_access' THEN 'all'
  WHEN COALESCE(loan_access_mode, 'encompass_sync') = 'manual' THEN 'manual'
  WHEN COALESCE(loan_access_mode, 'encompass_sync') = 'no_access' THEN 'none'
  ELSE 'encompass'
END
WHERE loan_scope IS NULL;

ALTER TABLE public.users
  ALTER COLUMN persona SET NOT NULL;

ALTER TABLE public.users
  ALTER COLUMN loan_scope SET NOT NULL;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_persona_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_persona_check
  CHECK (persona IN ('tenant_admin', 'tenant_user', 'tenant_canvas_only_user'));

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_loan_scope_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_loan_scope_check
  CHECK (loan_scope IN ('all', 'encompass', 'manual', 'none'));

-- Keep legacy columns in sync for mixed-version reads/writes.
UPDATE public.users
SET access_mode = CASE
  WHEN persona = 'tenant_canvas_only_user' THEN 'canvas_only'
  ELSE 'full'
END;

UPDATE public.users
SET loan_access_mode = CASE
  WHEN loan_scope = 'all' THEN 'full_access'
  WHEN loan_scope = 'manual' THEN 'manual'
  WHEN loan_scope = 'none' THEN 'no_access'
  ELSE 'encompass_sync'
END;

CREATE INDEX IF NOT EXISTS idx_users_persona ON public.users(persona);
CREATE INDEX IF NOT EXISTS idx_users_loan_scope ON public.users(loan_scope);

COMMENT ON COLUMN public.users.persona IS
  'Canonical tenant user persona: tenant_admin, tenant_user, tenant_canvas_only_user';

COMMENT ON COLUMN public.users.loan_scope IS
  'Canonical loan visibility scope: all, encompass, manual, none';
