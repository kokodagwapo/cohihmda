-- =============================================================================
-- Migration 050: Add sharing/visibility columns to workbench_canvases
-- =============================================================================
-- Enables platform admins and tenant admins to create canvases visible to
-- all tenant users (global) or shared with specific users.

ALTER TABLE public.workbench_canvases
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS created_by_role TEXT,
  ADD COLUMN IF NOT EXISTS shared_with_user_ids UUID[] DEFAULT '{}';

COMMENT ON COLUMN public.workbench_canvases.visibility IS
  'private = owner only, global = all tenant users, shared = specific users';
COMMENT ON COLUMN public.workbench_canvases.created_by_role IS
  'Role of the user who created the canvas (super_admin, platform_admin, tenant_admin, user, etc.)';
COMMENT ON COLUMN public.workbench_canvases.shared_with_user_ids IS
  'Array of user IDs who can view the canvas when visibility = shared';

CREATE INDEX IF NOT EXISTS idx_workbench_canvases_visibility
  ON public.workbench_canvases(visibility);
