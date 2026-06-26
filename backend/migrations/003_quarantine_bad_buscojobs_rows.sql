DELETE FROM candidates
WHERE (
  EXISTS (
    SELECT 1 FROM candidate_sources cs
    WHERE cs.candidate_id = candidates.id
      AND cs.source_type = 'buscojobs'
  )
  OR 'buscojobs' = ANY(coalesce(candidates.ai_tags, '{}'::text[]))
)
AND (
  candidates.full_name ~* '[/{}<>]|\[object Object\]|^(Autodromo|Barra de Carrasco|Ciudad de la Costa|Comercial|Comercial / Mercadeo|Comercial Mercadeo|El Pinar|Fray Bentos|Jose Pedro Varela|Libertad|Lomas de Solymar|Malvin|Melo|Montevideo|Neptunia|Playa Pascual|Rivera|Salinas|Salto|Solymar|Suarez|Toledo|Treinta y Tres|Administracion de Empresas|Asistencia Social|Diseno Grafico)$'
  OR (
    cardinality(coalesce(candidates.email, '{}'::text[])) = 0
    AND cardinality(coalesce(candidates.phone, '{}'::text[])) = 0
    AND coalesce(candidates.linkedin_url, '') = ''
    AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.candidate_id = candidates.id)
    AND (
      coalesce(candidates.ai_summary, '') ~* 'Buscamos|Estamos buscando|Importante empresa|Requisitos|Principales tareas|Tareas:|Jornada|Carnet|perfil psicografico|postulantes|candidatos|oferta|\[object Object\]'
      OR coalesce(candidates.current_role, '') ~* 'Buscamos|Estamos buscando|Importante empresa|Requisitos|Principales tareas|Tareas:|Jornada|Carnet|perfil psicografico|postulantes|candidatos|oferta|\[object Object\]'
    )
  )
);