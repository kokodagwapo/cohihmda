-- Migration 099: Drop FK constraints on tenant_calculations.created_by / updated_by
--
-- Platform admins (super_admin, platform_admin) exist in the management DB only,
-- not in any tenant's users table.  Migration 084 dropped the same FKs for other
-- tables (workbench_canvases, chat_sessions, distribution_schedules, etc.) but
-- tenant_calculations was created after that migration and inherited the same issue.
--
-- Without this fix, any platform admin saving a revenue formula in prod gets:
--   "insert or update on table "tenant_calculations" violates foreign key constraint
--    "tenant_calculations_updated_by_fkey""

ALTER TABLE public.tenant_calculations
  DROP CONSTRAINT IF EXISTS tenant_calculations_created_by_fkey;

ALTER TABLE public.tenant_calculations
  DROP CONSTRAINT IF EXISTS tenant_calculations_updated_by_fkey;
