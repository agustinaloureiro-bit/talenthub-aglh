CREATE TABLE IF NOT EXISTS rejected_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,
  source_id TEXT,
  source_url TEXT,
  extracted_name TEXT,
  reason TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rejected_imports_source_created ON rejected_imports (source_type, created_at DESC);