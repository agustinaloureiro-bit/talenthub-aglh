-- Give historical documents a stable content identity when the importer did not
-- provide one. Exact text matches are safe to consolidate within one candidate.
UPDATE documents
SET file_hash = 'text-md5:' || md5(raw_text)
WHERE nullif(file_hash, '') IS NULL
  AND nullif(raw_text, '') IS NOT NULL;

WITH ranked AS (
  SELECT
    id,
    candidate_id,
    file_hash,
    row_number() OVER (
      PARTITION BY candidate_id, file_hash
      ORDER BY
        (file_data IS NOT NULL) DESC,
        is_primary_cv DESC,
        length(coalesce(raw_text, '')) DESC,
        created_at DESC,
        id DESC
    ) AS position,
    bool_or(is_primary_cv) OVER (PARTITION BY candidate_id, file_hash) AS was_primary
  FROM documents
  WHERE nullif(file_hash, '') IS NOT NULL
), primary_flags AS (
  UPDATE documents d
  SET is_primary_cv = true
  FROM ranked r
  WHERE d.id = r.id
    AND r.position = 1
    AND r.was_primary
  RETURNING d.id
)
DELETE FROM documents d
USING ranked r
WHERE d.id = r.id
  AND r.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS documents_candidate_file_hash_unique_idx
  ON documents(candidate_id, file_hash)
  WHERE nullif(file_hash, '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS documents_candidate_id_idx
  ON documents(candidate_id);

CREATE INDEX IF NOT EXISTS candidate_sources_candidate_id_idx
  ON candidate_sources(candidate_id);

CREATE INDEX IF NOT EXISTS documents_search_vector_idx
  ON documents USING gin (
    to_tsvector('spanish', coalesce(raw_text, '') || ' ' || coalesce(file_name, ''))
  );

CREATE INDEX IF NOT EXISTS candidates_search_vector_idx
  ON candidates USING gin (
    to_tsvector(
      'spanish',
      coalesce(full_name, '') || ' ' ||
      coalesce(current_role, '') || ' ' ||
      coalesce(ai_summary, '')
    )
  );
