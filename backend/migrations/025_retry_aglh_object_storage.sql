UPDATE documents
SET extraction_started_at = NULL,
    extraction_next_attempt_at = NULL,
    extraction_last_error = NULL
WHERE source_type = 'aglh'
  AND processed_at IS NULL
  AND extraction_last_error LIKE 'AGLH respondió HTTP 400%';
