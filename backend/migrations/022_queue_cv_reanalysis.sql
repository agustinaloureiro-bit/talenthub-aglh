UPDATE documents
SET processed_at = NULL
WHERE (is_primary_cv = true OR lower(type) IN ('cv', 'resume', 'curriculum'))
  AND (
    length(coalesce(raw_text, '')) >= 80
    OR file_data IS NOT NULL
  );
