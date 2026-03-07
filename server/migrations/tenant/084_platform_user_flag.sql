-- Remove FK constraints on user_id/created_by columns for tables that platform
-- staff interact with.  Platform admins (super_admin, platform_admin) exist in
-- the management DB, not in the tenant users table.  Dropping these FKs lets
-- their real UUIDs be stored without needing "shadow" user rows.
--
-- Application-level cascade is handled in the admin user-delete route.

-- workbench_canvases.user_id
ALTER TABLE public.workbench_canvases
  DROP CONSTRAINT IF EXISTS workbench_canvases_user_id_fkey;

-- chat_sessions.user_id
ALTER TABLE public.chat_sessions
  DROP CONSTRAINT IF EXISTS chat_sessions_user_id_fkey;

-- chat_history.user_id
ALTER TABLE public.chat_history
  DROP CONSTRAINT IF EXISTS chat_history_user_id_fkey;

-- canvas_share_entries.shared_by
ALTER TABLE public.canvas_share_entries
  DROP CONSTRAINT IF EXISTS canvas_share_entries_shared_by_fkey;

-- distribution_recipient_lists.created_by
ALTER TABLE public.distribution_recipient_lists
  DROP CONSTRAINT IF EXISTS distribution_recipient_lists_created_by_fkey;

-- distribution_schedules.created_by
ALTER TABLE public.distribution_schedules
  DROP CONSTRAINT IF EXISTS distribution_schedules_created_by_fkey;

-- Drop the is_platform_user column if it was already added by a prior deploy.
ALTER TABLE public.users
  DROP COLUMN IF EXISTS is_platform_user;
