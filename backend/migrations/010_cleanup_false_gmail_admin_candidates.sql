DELETE FROM candidates c
WHERE c.duplicate_of IS NULL
  AND (
    EXISTS (
      SELECT 1
      FROM candidate_sources cs
      WHERE cs.candidate_id = c.id
        AND cs.source_type = 'gmail'
    )
    OR 'gmail' = ANY(coalesce(c.ai_tags, '{}'::text[]))
  )
  AND cardinality(coalesce(c.email, '{}'::text[])) = 0
  AND cardinality(coalesce(c.phone, '{}'::text[])) = 0
  AND coalesce(c.linkedin_url, '') = ''
  AND (
    lower(coalesce(c.full_name, '')) IN (
      'the google cloud team',
      'google cloud team',
      'google workspace team',
      'google team',
      'microsoft account team',
      'linkedin notifications'
    )
    OR lower(coalesce(c.current_role, '')) LIKE '%work account access%'
    OR lower(coalesce(c.ai_summary, '')) LIKE '%your request for work account access%'
    OR lower(coalesce(c.ai_summary, '')) LIKE '%google cloud%'
    OR lower(coalesce(c.ai_summary, '')) LIKE '%google workspace%'
    OR lower(coalesce(c.ai_summary, '')) LIKE '%security alert%'
    OR lower(coalesce(c.ai_summary, '')) LIKE '%billing%'
    OR lower(coalesce(c.ai_summary, '')) LIKE '%verification code%'
  );
