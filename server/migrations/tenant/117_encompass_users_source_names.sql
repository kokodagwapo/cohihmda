-- Preserve source Encompass user names from /encompass/v3/users.
--
-- `encompass_users.full_name` was originally a generated first_name + last_name
-- column, which loses middle names and suffixes. Loan records often store the
-- source `fullName` exactly, so keep that API value separately and prefer it
-- when matching loan actors to Encompass users.

ALTER TABLE public.encompass_users
  ADD COLUMN IF NOT EXISTS middle_name TEXT,
  ADD COLUMN IF NOT EXISTS encompass_full_name TEXT;

COMMENT ON COLUMN public.encompass_users.middle_name IS
  'Middle name from Encompass /v3/users, when provided.';

COMMENT ON COLUMN public.encompass_users.encompass_full_name IS
  'Raw fullName from Encompass /v3/users; preferred for actor-name matching.';

CREATE INDEX IF NOT EXISTS idx_encompass_users_encompass_full_name
  ON public.encompass_users(encompass_full_name)
  WHERE encompass_full_name IS NOT NULL;
