UPDATE candidate_sources
SET source_created_at = (source_data->>'date')::timestamptz
WHERE source_type = 'gmail'
  AND source_created_at IS NULL
  AND coalesce(source_data->>'date', '') ~* '^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),? [0-9]{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} ([+-][0-9]{4}|[A-Z]{2,5})';

UPDATE candidate_sources
SET source_created_at = to_timestamp((source_data->>'internalDate')::double precision / 1000.0)
WHERE source_type = 'gmail'
  AND source_created_at IS NULL
  AND coalesce(source_data->>'internalDate', '') ~ '^\d{12,13}$';
