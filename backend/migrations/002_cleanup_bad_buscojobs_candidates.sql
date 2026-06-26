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
AND (
  candidates.full_name ~* '[/]|^(Autodromo|Barra de Carrasco|Ciudad de la Costa|Comercial|Comercial / Mercadeo|El Pinar|Fray Bentos|Jose Pedro Varela|Libertad|Lomas de Solymar|Malvin|Melo|Montevideo|Neptunia|Playa Pascual|Rivera|Salinas|Salto|Solymar|Suarez|Toledo|Treinta y Tres|Administracion de Empresas|Asistencia Social|Diseno Grafico)$'
  OR coalesce(candidates.ai_summary, '') ~* 'Buscamos|Estamos buscando|Importante empresa|Requisitos|Principales tareas|Tareas:|Jornada|Carnet|\[object Object\]'
  OR coalesce(candidates.current_role, '') ~* 'Buscamos|Estamos buscando|Importante empresa|Requisitos|Principales tareas|Tareas:|Jornada|Carnet|\[object Object\]'
);

DELETE FROM candidates
WHERE full_name IN ('_gads','_gpi','_eoi','isiframeenabled','buscojobs-_zldt','buscojobs-_zldp','_hjSession_1333623','_hjSessionUser_1333623')
AND cardinality(coalesce(email, '{}'::text[])) = 0
AND cardinality(coalesce(phone, '{}'::text[])) = 0;