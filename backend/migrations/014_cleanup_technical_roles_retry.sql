WITH normalized AS (
  SELECT
    id,
    (
      SELECT tag
      FROM unnest(ai_tags) AS tag
      WHERE lower(tag) IN (
        'abogado',
        'administracion',
        'atencion al cliente',
        'comercial',
        'gastronomia',
        'logistica',
        'marketing',
        'recursos humanos',
        'tecnico',
        'ventas'
      )
      LIMIT 1
    ) AS replacement_role,
    COALESCE(
      (
        SELECT array_agg(DISTINCT tag)
        FROM unnest(ai_tags) AS tag
        WHERE lower(tag) NOT IN (
          'postgres',
          'postgresql',
          'database',
          'supabase',
          'render',
          'gmail',
          'google',
          'drive',
          'cv',
          'curriculum',
          'curriculo',
          'currículo',
          'currículum',
          'vitae',
          'pdf',
          'doc',
          'docx',
          'rtf',
          'txt'
        )
      ),
      '{}'::text[]
    ) AS cleaned_tags
  FROM candidates
  WHERE lower(coalesce("current_role", '')) IN (
      'postgres',
      'postgresql',
      'database',
      'supabase',
      'render',
      'gmail',
      'google',
      'drive',
      'cv',
      'curriculum',
      'curriculo',
      'currículo',
      'currículum',
      'vitae',
      'pdf',
      'doc',
      'docx',
      'rtf',
      'txt',
      'postulación laboral',
      'postulacion laboral',
      'trabajo',
      'empleo'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ai_tags) AS tag
      WHERE lower(tag) IN (
        'postgres',
        'postgresql',
        'database',
        'supabase',
        'render',
        'gmail',
        'google',
        'drive',
        'cv',
        'curriculum',
        'curriculo',
        'currículo',
        'currículum',
        'vitae',
        'pdf',
        'doc',
        'docx',
        'rtf',
        'txt'
      )
    )
)
UPDATE candidates
SET
  "current_role" = CASE
    WHEN lower(coalesce(candidates."current_role", '')) IN (
      'postgres',
      'postgresql',
      'database',
      'supabase',
      'render',
      'gmail',
      'google',
      'drive',
      'cv',
      'curriculum',
      'curriculo',
      'currículo',
      'currículum',
      'vitae',
      'pdf',
      'doc',
      'docx',
      'rtf',
      'txt',
      'postulación laboral',
      'postulacion laboral',
      'trabajo',
      'empleo'
    )
    THEN normalized.replacement_role
    ELSE candidates."current_role"
  END,
  ai_tags = normalized.cleaned_tags,
  updated_at = now()
FROM normalized
WHERE candidates.id = normalized.id;
