ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS extraction_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extraction_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extraction_next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extraction_last_error TEXT;

CREATE INDEX IF NOT EXISTS documents_extraction_queue_idx
  ON documents(source_type, extraction_next_attempt_at, created_at)
  WHERE processed_at IS NULL;

-- A deploy or process restart must release work that was claimed but never
-- completed. The worker also treats claims older than ten minutes as stale.
UPDATE documents
SET extraction_started_at = NULL
WHERE processed_at IS NULL
  AND extraction_started_at < now() - interval '10 minutes';
