CREATE TABLE IF NOT EXISTS season_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  department TEXT,
  city TEXT,
  radius_km INTEGER,
  role TEXT NOT NULL,
  experience_level TEXT,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  exclude_keywords TEXT[] NOT NULL DEFAULT '{}',
  query_text TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_season_searches_status ON season_searches (status);
CREATE INDEX IF NOT EXISTS idx_season_searches_created_at ON season_searches (created_at DESC);

CREATE TABLE IF NOT EXISTS season_search_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_search_id UUID NOT NULL REFERENCES season_searches(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  match_reason TEXT,
  source_types TEXT[] NOT NULL DEFAULT '{}',
  profile_url TEXT,
  first_found_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_found_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reserved_at TIMESTAMPTZ,
  reserved_by UUID REFERENCES users(id),
  UNIQUE (season_search_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_season_results_search_score ON season_search_results (season_search_id, score DESC, last_found_at DESC);
CREATE INDEX IF NOT EXISTS idx_season_results_candidate ON season_search_results (candidate_id);
CREATE INDEX IF NOT EXISTS idx_season_results_reserved ON season_search_results (season_search_id, reserved_at);
