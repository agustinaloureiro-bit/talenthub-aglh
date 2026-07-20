-- Preserve historically mixed profiles and their CVs, but keep them out of normal search.
-- These thresholds target only severe multi-person contact contamination.
UPDATE candidates c
SET status = 'needs_review', updated_at = now()
WHERE c.status = 'active'
  AND c.duplicate_of IS NULL
  AND EXISTS (
    SELECT 1
    FROM candidate_sources cs
    WHERE cs.candidate_id = c.id
      AND cs.source_type = 'gmail'
  )
  AND EXISTS (SELECT 1 FROM documents d WHERE d.candidate_id = c.id)
  AND (
    cardinality(coalesce(c.email, '{}'::text[])) >= 5
    OR cardinality(coalesce(c.phone, '{}'::text[])) >= 8
  );
