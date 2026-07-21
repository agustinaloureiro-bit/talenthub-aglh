-- Drive is no longer an active connector. Candidate documents previously
-- imported from it remain available; only its runtime configuration is removed.
DELETE FROM sync_logs WHERE integration_id = 'drive';
DELETE FROM agent_runs WHERE agent_id = 'drive';
DELETE FROM agent_candidate_cache WHERE agent_id = 'drive';
DELETE FROM integrations WHERE id = 'drive';

CREATE INDEX IF NOT EXISTS candidates_search_vector_idx
  ON candidates USING gin (
    to_tsvector('spanish'::regconfig, coalesce(full_name, '') || ' ' || coalesce(current_role, '') || ' ' || coalesce(ai_summary, ''))
  );

CREATE INDEX IF NOT EXISTS candidate_sources_active_source_candidate_idx
  ON candidate_sources(source_type, candidate_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS documents_candidate_primary_created_idx
  ON documents(candidate_id, is_primary_cv DESC, created_at DESC);
