ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

ALTER TABLE candidate_sources
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

CREATE OR REPLACE FUNCTION talenthub_candidate_search_vector()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector := to_tsvector(
    'spanish'::regconfig,
    coalesce(NEW.full_name, '') || ' ' ||
    coalesce(NEW."current_role", '') || ' ' ||
    coalesce(NEW.city, '') || ' ' ||
    coalesce(NEW.country, '') || ' ' ||
    array_to_string(coalesce(NEW.ai_tags, '{}'::text[]), ' ') || ' ' ||
    coalesce(NEW.ai_summary, '')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS candidates_search_vector_insert_trigger ON candidates;
CREATE TRIGGER candidates_search_vector_insert_trigger
BEFORE INSERT
ON candidates
FOR EACH ROW
EXECUTE FUNCTION talenthub_candidate_search_vector();

DROP TRIGGER IF EXISTS candidates_search_vector_update_trigger ON candidates;
CREATE TRIGGER candidates_search_vector_update_trigger
BEFORE UPDATE OF full_name, "current_role", city, country, ai_tags, ai_summary
ON candidates
FOR EACH ROW
WHEN (
  OLD.full_name IS DISTINCT FROM NEW.full_name
  OR OLD."current_role" IS DISTINCT FROM NEW."current_role"
  OR OLD.city IS DISTINCT FROM NEW.city
  OR OLD.country IS DISTINCT FROM NEW.country
  OR OLD.ai_tags IS DISTINCT FROM NEW.ai_tags
  OR OLD.ai_summary IS DISTINCT FROM NEW.ai_summary
)
EXECUTE FUNCTION talenthub_candidate_search_vector();

UPDATE candidates
SET search_vector = to_tsvector(
  'spanish'::regconfig,
  coalesce(full_name, '') || ' ' ||
  coalesce("current_role", '') || ' ' ||
  coalesce(city, '') || ' ' ||
  coalesce(country, '') || ' ' ||
  array_to_string(coalesce(ai_tags, '{}'::text[]), ' ') || ' ' ||
  coalesce(ai_summary, '')
)
WHERE search_vector IS NULL;

CREATE INDEX IF NOT EXISTS candidates_search_vector_idx
  ON candidates USING gin (search_vector);

CREATE INDEX IF NOT EXISTS candidate_sources_content_hash_idx
  ON candidate_sources(source_type, source_id, content_hash)
  WHERE source_id IS NOT NULL AND content_hash IS NOT NULL;
