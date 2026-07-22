ALTER TABLE candidate_sources
  ADD COLUMN IF NOT EXISTS source_created_at timestamptz;

CREATE INDEX IF NOT EXISTS candidate_sources_active_created_candidate_idx
  ON candidate_sources(source_created_at DESC, candidate_id)
  WHERE is_active = true AND source_created_at IS NOT NULL;

UPDATE candidate_sources
SET source_created_at = CASE
  WHEN coalesce(source_data->>'created_at', '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' THEN (source_data->>'created_at')::timestamptz
  WHEN coalesce(source_data->>'receivedAt', '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' THEN (source_data->>'receivedAt')::timestamptz
  WHEN coalesce(source_data->>'submittedAt', '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' THEN (source_data->>'submittedAt')::timestamptz
  ELSE source_created_at
END
WHERE source_created_at IS NULL;
