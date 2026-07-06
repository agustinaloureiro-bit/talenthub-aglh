DELETE FROM candidates
WHERE (
  EXISTS (
    SELECT 1
    FROM candidate_sources cs
    WHERE cs.candidate_id = candidates.id
      AND cs.source_type = 'buscojobs'
  )
  OR 'buscojobs' = ANY(coalesce(candidates.ai_tags, '{}'::text[]))
)
AND cardinality(coalesce(candidates.email, '{}'::text[])) = 0
AND cardinality(coalesce(candidates.phone, '{}'::text[])) = 0
AND coalesce(candidates.linkedin_url, '') = ''
AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.candidate_id = candidates.id)
AND (
  candidates.full_name ILIKE '%[object Object]%'
  OR candidates.full_name LIKE '%/%'
  OR candidates.full_name LIKE '%{%'
  OR candidates.full_name LIKE '%}%'
  OR candidates.full_name LIKE '%<%'
  OR candidates.full_name LIKE '%>%'
  OR lower(candidates.full_name) = ANY(ARRAY[
    'autodromo',
    'barra de carrasco',
    'ciudad de la costa',
    'comercial',
    'comercial / mercadeo',
    'comercial mercadeo',
    'el pinar',
    'fray bentos',
    'jose pedro varela',
    'libertad',
    'lomas de solymar',
    'malvin',
    'melo',
    'montevideo',
    'neptunia',
    'playa pascual',
    'rivera',
    'salinas',
    'salto',
    'solymar',
    'suarez',
    'toledo',
    'treinta y tres',
    'administracion de empresas',
    'asistencia social',
    'diseno grafico'
  ])
  OR lower(coalesce(candidates.ai_summary, '')) LIKE '%buscamos%'
  OR lower(coalesce(candidates.ai_summary, '')) LIKE '%estamos buscando%'
  OR lower(coalesce(candidates.ai_summary, '')) LIKE '%importante empresa%'
  OR lower(coalesce(candidates.ai_summary, '')) LIKE '%requisitos%'
  OR lower(coalesce(candidates.ai_summary, '')) LIKE '%principales tareas%'
  OR lower(coalesce(candidates.ai_summary, '')) LIKE '%tareas:%'
  OR lower(coalesce(candidates.ai_summary, '')) LIKE '%jornada%'
  OR lower(coalesce(candidates.ai_summary, '')) LIKE '%carnet%'
  OR lower(coalesce(candidates.ai_summary, '')) LIKE '%perfil psicografico%'
  OR lower(coalesce(candidates.ai_summary, '')) LIKE '%[object object]%'
);
