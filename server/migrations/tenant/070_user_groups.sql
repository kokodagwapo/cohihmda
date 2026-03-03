-- =============================================================================
-- Migration 070: User groups and memberships for canvas sharing
-- =============================================================================
-- Enables admins to create groups (e.g. Sales Team, Branch Managers) and share
-- canvases with groups in addition to individual users.

CREATE TABLE IF NOT EXISTS public.user_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  color VARCHAR(7),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name)
);

CREATE TABLE IF NOT EXISTS public.user_group_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.user_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_groups_name ON public.user_groups(name);
CREATE INDEX IF NOT EXISTS idx_user_groups_active ON public.user_groups(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_group_memberships_group_id ON public.user_group_memberships(group_id);
CREATE INDEX IF NOT EXISTS idx_user_group_memberships_user_id ON public.user_group_memberships(user_id);

COMMENT ON TABLE public.user_groups IS 'Groups of users for sharing canvases (e.g. Sales Team, Branch Managers)';
COMMENT ON TABLE public.user_group_memberships IS 'Maps users to groups';

DROP TRIGGER IF EXISTS trigger_user_groups_updated_at ON public.user_groups;
CREATE TRIGGER trigger_user_groups_updated_at
  BEFORE UPDATE ON public.user_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
