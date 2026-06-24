CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'recruiter', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'viewer',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  email TEXT[] NOT NULL DEFAULT '{}',
  phone TEXT[] NOT NULL DEFAULT '{}',
  document_number TEXT,
  document_type TEXT,
  nationality TEXT,
  country TEXT,
  city TEXT,
  linkedin_url TEXT,
  avatar_url TEXT,
  birth_date DATE,
  gender TEXT,
  "current_role" TEXT,
  ai_summary TEXT,
  ai_seniority TEXT,
  ai_seniority_years INTEGER,
  ai_tags TEXT[] NOT NULL DEFAULT '{}',
  ai_skills JSONB NOT NULL DEFAULT '[]',
  ai_languages JSONB NOT NULL DEFAULT '[]',
  ai_industries TEXT[] NOT NULL DEFAULT '{}',
  ai_roles TEXT[] NOT NULL DEFAULT '{}',
  ai_strengths TEXT[] NOT NULL DEFAULT '{}',
  ai_weaknesses TEXT[] NOT NULL DEFAULT '{}',
  embedding vector(3072),
  status TEXT NOT NULL DEFAULT 'active',
  quality_score INTEGER NOT NULL DEFAULT 0 CHECK (quality_score BETWEEN 0 AND 100),
  duplicate_of UUID REFERENCES candidates(id),
  is_canonical BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  source_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_candidates_tags ON candidates USING GIN (ai_tags);
CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates USING GIN (email);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates (status);
CREATE INDEX IF NOT EXISTS idx_candidates_seniority ON candidates (ai_seniority);

CREATE TABLE IF NOT EXISTS candidate_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT,
  source_url TEXT,
  source_data JSONB NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS candidate_work_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  company TEXT NOT NULL,
  position TEXT NOT NULL,
  position_norm TEXT,
  industry TEXT,
  start_date DATE,
  end_date DATE,
  is_current BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  location TEXT,
  source TEXT,
  ai_extracted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidate_education (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  institution TEXT NOT NULL,
  degree TEXT,
  field TEXT,
  start_year INTEGER,
  end_year INTEGER,
  is_completed BOOLEAN,
  source TEXT,
  ai_extracted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS processes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  client TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  recruiter_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidate_processes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  process_id UUID REFERENCES processes(id) ON DELETE SET NULL,
  process_name TEXT NOT NULL,
  client TEXT NOT NULL,
  stage TEXT NOT NULL,
  recruiter_id UUID REFERENCES users(id),
  event_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT,
  file_hash TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  raw_text TEXT,
  ai_summary TEXT,
  embedding vector(3072),
  source_type TEXT,
  source_id TEXT,
  source_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  is_primary_cv BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  process_id UUID REFERENCES processes(id),
  interviewer_id UUID REFERENCES users(id),
  date TIMESTAMPTZ,
  type TEXT,
  notes TEXT,
  ai_summary TEXT,
  ai_strengths TEXT[] NOT NULL DEFAULT '{}',
  ai_weaknesses TEXT[] NOT NULL DEFAULT '{}',
  ai_recommendation TEXT,
  source_type TEXT,
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  process_id UUID REFERENCES processes(id),
  evaluator_id UUID REFERENCES users(id),
  type TEXT NOT NULL,
  score INTEGER CHECK (score BETWEEN 0 AND 100),
  result TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_configured',
  config JSONB NOT NULL DEFAULT '{}',
  last_sync_at TIMESTAMPTZ,
  total_imported INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id TEXT REFERENCES integrations(id),
  source TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  new_records INTEGER NOT NULL DEFAULT 0,
  updated_records INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  message TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  query TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  candidate_refs UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO integrations (id, name)
VALUES
  ('aglh', 'AGLH Platform'),
  ('yoiners', 'Yoiners'),
  ('buscojobs', 'Buscojobs'),
  ('gmail', 'Gmail'),
  ('drive', 'Google Drive'),
  ('linkedin', 'LinkedIn Recruiter')
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_settings (key, value)
VALUES
  ('organization', '{"name":"","country":"","timezone":"America/Montevideo"}'),
  ('ai', '{"provider":"","chatModel":"","embeddingModel":"","deduplicationThreshold":0.92}'),
  ('notifications', '{"alertEmail":"","syncFailure":true,"duplicates":true}')
ON CONFLICT (key) DO NOTHING;
