DELETE FROM candidate_sources cs
WHERE NOT EXISTS (
  SELECT 1
  FROM candidates c
  WHERE c.id = cs.candidate_id
);
