# TalentHub AGLH: mapa del producto enterprise

## Objetivo operativo

El flujo principal es:

1. El reclutador sincroniza fuentes configuradas.
2. Cada conector recupera solo registros nuevos o modificados.
3. TalentHub normaliza, valida, deduplica y guarda candidatos y documentos.
4. PostgreSQL actualiza el indice de busqueda permanente.
5. Talent Finder interpreta la consulta y busca exclusivamente en PostgreSQL.
6. El ranking aplica evidencia laboral, actualidad, ubicacion y adecuacion.
7. El reclutador abre la ficha y el CV sin perder su busqueda.

La busqueda no consulta Gmail, AGLH, Buscojobs ni Yoiners en tiempo real.

## Recorrido de sincronizacion

`POST /api/integrations/sync-all`

1. `routes/integrations.ts` obtiene las integraciones configuradas.
2. Ejecuta conectores en una cola con concurrencia limitada.
3. Cada conector implementa `IntegrationAgent` y devuelve `CandidateImport[]`.
4. Los conectores conservan cursores o puntos de control en `integrations.config`.
5. `syncIntegration` normaliza filas historicas y delega en `importCandidate`.
6. `importCandidate`:
   - rechaza filas que no representan personas con CV;
   - compara la huella de contenido del registro;
   - omite sin reprocesar si la huella no cambio;
   - resuelve identidad por fuente, email y telefono con validacion de nombre;
   - actualiza o crea la ficha canonica;
   - asocia la fuente;
   - guarda documentos deduplicados por hash.
7. Triggers de PostgreSQL mantienen `candidates.search_vector`.
8. El indice GIN existente de `documents` mantiene indexado el texto de los CV.
9. Se registran nuevos, actualizados, sin cambios, errores, duracion y mensaje.

## Recorrido de busqueda

`POST /api/search/talent`

1. `queryInterpreter.ts` convierte lenguaje natural en roles, competencias,
   idiomas, ubicaciones, industrias y restricciones laborales objetivas.
2. `intelligenceEngine.ts` construye una consulta ampliada.
3. `findCandidates` consulta exclusivamente:
   - `candidates.search_vector`, persistido e indexado;
   - el indice GIN permanente de `documents`;
   - filtros estructurados de fuente, seniority, contacto y fecha.
4. La consulta recupera candidatos con CV y limita el conjunto previo al ranking.
5. `candidateRanker.ts` verifica evidencia, actualidad, ubicacion, nivel del
   perfil y exclusiones de incompatibilidad.
6. La API pagina resultados y devuelve explicacion, score, fuente, contacto y
   documento principal.
7. El frontend conserva la consulta al navegar entre resultados, modal de CV y
   ficha.

## Estado por modulo

### Operativo

- Base central PostgreSQL/Supabase.
- Conectores modulares mediante `IntegrationAgent`.
- Gmail incremental e historico.
- AGLH incremental.
- Buscojobs con autenticacion y postulantes.
- Yoiners paginado e incremental.
- Validacion de personas reales con CV.
- Deduplicacion por fuente e identidad corroborada.
- Hash de documentos.
- Fichas, descarga y previsualizacion de CV.
- Busqueda hibrida estructurada y full-text.
- Ranking explicable basado en evidencia laboral.
- Pruebas funcionales de conectores, identidad, CV y busqueda.

### Parcial

- La deduplicacion no tiene una cola de revision manual para casos ambiguos.
- La extraccion estructurada cubre areas, idiomas, residencia y resumen, pero no
  persiste toda la experiencia y educacion de todos los conectores.
- La geografia usa coordenadas, radios y distancia real para las localidades
  uruguayas catalogadas, ademas de priorizar el domicilio extraido del CV; el
  catalogo todavia no cubre todo el territorio nacional.
- El full-text es permanente; los campos `embedding` existen, pero no hay un
  proveedor configurado ni busqueda vectorial activa.
- Los cursores dependen de las capacidades reales de cada plataforma.
- El centro de sincronizacion muestra estado por fuente, pero no todas las
  metricas globales del indice solicitadas.

### Pendiente

- Reconstruccion completa del indice como trabajo administrativo en segundo
  plano con progreso.
- Pipeline de embeddings con version de modelo y revectorizacion controlada.
- Completar el catalogo geografico de Uruguay y permitir radios configurables.
- Aprendizaje a partir de acciones del reclutador.
- Metricas persistidas de latencia, cobertura y calidad del indice.
- Pruebas end-to-end contra una base efimera y navegador en CI.
- LinkedIn Recruiter, sujeto a acceso autorizado y capacidades oficiales.

## Cuello de botella corregido

Antes, cada busqueda reconstruia el vector de todos los candidatos en tiempo
real y cada sincronizacion reportaba como actualizado un registro identico.

Desde la migracion `020_persisted_candidate_search.sql`:

- el vector de candidato se calcula al insertar o cambiar datos buscables;
- el indice GIN se reutiliza en cada busqueda;
- el texto de documentos reutiliza el indice permanente ya existente;
- una huella por fuente evita reprocesar registros sin cambios;
- los registros identicos se reportan como `sin cambios`, no como errores ni
  actualizaciones.

## Regla de evolucion

No se agrega una fuente ni una funcion nueva si rompe el recorrido principal:

`sincronizar -> normalizar -> deduplicar -> indexar -> buscar -> abrir CV`.

Cada cambio debe incluir compilacion, pruebas funcionales y validacion del
deploy antes de considerarse terminado.
