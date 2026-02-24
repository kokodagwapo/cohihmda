-- Add cognito_sub to link tenant users to their Cognito identity.

ALTER TABLE users ADD COLUMN IF NOT EXISTS cognito_sub TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_users_cognito_sub ON users(cognito_sub);
