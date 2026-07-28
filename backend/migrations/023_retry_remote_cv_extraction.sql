-- Remote CVs that failed once used to be marked as processed permanently.
-- Queue them again so each normal synchronization can repair a bounded batch.
UPDATE documents
SET processed_at = NULL
WHERE source_type IN ('aglh', 'yoiners', 'buscojobs')
  AND length(coalesce(raw_text, '')) < 80
  AND (
    coalesce(file_url, '') ~ '^https://'
    OR coalesce(source_path, '') ~ '^https://'
    OR coalesce(source_id, '') ~ '^buscojobs:'
  );
