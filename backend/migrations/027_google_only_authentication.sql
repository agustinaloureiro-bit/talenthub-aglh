ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS google_subject TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

ALTER TABLE users DROP COLUMN IF EXISTS password_hash;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_subject
  ON users (google_subject)
  WHERE google_subject IS NOT NULL;
