CREATE INDEX IF NOT EXISTS candidates_search_vector_idx
  ON candidates USING gin (
    to_tsvector(
      'spanish'::regconfig,
      coalesce(full_name, '') || ' ' ||
      coalesce(current_role, '') || ' ' ||
      coalesce(ai_summary, '')
    )
  );
