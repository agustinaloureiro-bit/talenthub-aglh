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
  AND (
    lower(trim(coalesce(c.full_name, ''))) ~ '^(re|fw|fwd):'
    OR lower(trim(coalesce(c.full_name, ''))) ~ '\m(postulame|postularme|postulacion|postulación|futuras vacantes|solicitud de empleo|solicitud de trabajo)\M'
    OR lower(trim(coalesce(c.full_name, ''))) IN (
      'postulame para futuras vacantes',
      're postulame para futuras vacantes',
      'postulacion para futuras vacantes',
      'solicitud de empleo',
      'solicitud de trabajo'
    )
  );
