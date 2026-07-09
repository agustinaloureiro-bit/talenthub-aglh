DELETE FROM candidates
WHERE (
  EXISTS (
    SELECT 1
    FROM candidate_sources cs
    WHERE cs.candidate_id = candidates.id
      AND cs.source_type = 'gmail'
  )
  OR 'gmail' = ANY(coalesce(candidates.ai_tags, '{}'::text[]))
)
AND cardinality(coalesce(candidates.email, '{}'::text[])) = 0
AND cardinality(coalesce(candidates.phone, '{}'::text[])) = 0
AND coalesce(candidates.linkedin_url, '') = ''
AND (
  lower(candidates.full_name) = ANY(ARRAY[
    'the google cloud team',
    'google cloud team',
    'google workspace team',
    'google team',
    'microsoft account team',
    'linkedin notifications'
  ])
  OR lower(coalesce(candidates.ai_summary, '')) LIKE '%your request for work account access%'
  OR lower(coalesce(candidates.ai_summary, '')) LIKE '%google cloud%'
  OR lower(coalesce(candidates.ai_summary, '')) LIKE '%security alert%'
  OR lower(coalesce(candidates.ai_summary, '')) LIKE '%billing%'
);
