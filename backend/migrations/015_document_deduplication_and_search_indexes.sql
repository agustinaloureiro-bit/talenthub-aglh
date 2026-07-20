-- Historical duplicates are removed in bounded batches by cleanup:storage.
-- Keeping this migration index-only prevents a large startup transaction.

CREATE UNIQUE INDEX IF NOT EXISTS documents_candidate_file_hash_unique_idx
  ON documents(candidate_id, file_hash)
  WHERE nullif(file_hash, '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS documents_candidate_id_idx
  ON documents(candidate_id);

CREATE INDEX IF NOT EXISTS candidate_sources_candidate_id_idx
  ON candidate_sources(candidate_id);

CREATE INDEX IF NOT EXISTS documents_search_vector_idx
  ON documents USING gin (
    to_tsvector('spanish'::regconfig, coalesce(raw_text, '') || ' ' || coalesce(file_name, ''))
  );
