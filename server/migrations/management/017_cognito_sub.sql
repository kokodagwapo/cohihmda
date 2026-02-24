-- Add cognito_sub to link management users to their Cognito identity.
-- MFA is now managed by Cognito, so mfa_enabled/mfa_secret columns are left in place
-- but will no longer be written to by application code.

ALTER TABLE coheus_users ADD COLUMN IF NOT EXISTS cognito_sub TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_coheus_users_cognito_sub ON coheus_users(cognito_sub);
