# TalentHub AGLH - Auditoria de Producto

Fecha: 2026-07-10

## Objetivo de producto

El producto no esta terminado hasta que una persona pueda:

1. Abrir TalentHub.
2. Presionar Sincronizar.
3. Esperar a que se conecten todas las fuentes configuradas.
4. Buscar "Necesito un abogado con ingles".
5. Recibir candidatos reales, con fuente, datos utiles, experiencia y CV/documentos disponibles.

## Mapa real del flujo actual

### 1. Usuario presiona Sincronizar todo

Frontend:

- `frontend/src/App.tsx`
- Componente `Integrations`
- Funcion `syncAll()`
- Llama `POST /api/integrations/sync-all`

Backend:

- `backend/src/routes/integrations.ts`
- Ruta `POST /sync-all`
- Llama `syncConnectedIntegrations()`
- Selecciona integraciones con `status NOT IN ('not_configured','soon')` y `config <> '{}'`
- Ejecuta `syncIntegration(id)` con concurrencia 2

### 2. Cada fuente intenta obtener candidatos

Backend:

- `syncIntegration()` marca la fuente como `syncing`.
- Busca un conector en `AGENTS`.
- Ejecuta el conector con timeout configurable, por defecto 70 segundos.
- Si el conector devuelve `rows`, intenta importar cada candidato con `importCandidate()`.

Conectores existentes:

- `gmail`: usa OAuth de Google, lista correos con adjuntos y lee PDF/Word/texto.
- `drive`: usa OAuth de Google, busca archivos por nombre y extrae texto si puede.
- `buscojobs`: intenta API, cookies, login con credenciales y navegador Playwright.
- `aglh`: usa navegador generico sobre URLs configuradas.
- `yoiners`: usa navegador generico sobre URLs configuradas.
- `linkedin`: existe como integracion, pero no tiene conector real en `AGENTS`.

### 3. Guardado unificado

Backend:

- `backend/src/services/candidateIngestion.ts`
- Funcion `importCandidate(sourceType, candidate, isUsableCandidate)`
- Valida si parece candidato real.
- Busca duplicados por `source_id`, email o telefono.
- Inserta o actualiza `candidates`.
- Guarda origen en `candidate_sources`.
- Guarda documentos en `documents`.

### 4. El candidato aparece en pantalla

Backend:

- `GET /api/candidates`
- Lee `candidates`.
- Agrega conteo de documentos y nombre del documento principal.
- Excluye algunos falsos candidatos de Gmail.

Frontend:

- `Candidates`
- Muestra `CandidateRow`.
- Permite abrir `CandidateProfile`.
- En ficha se muestran documentos y botones para leer/descargar.

### 5. Busqueda

Talent Finder:

- `POST /api/search/talent`
- Opcionalmente ejecuta `syncConnectedIntegrations()`.
- Llama `searchTalent()`.
- `findCandidates()` busca en `candidates`, `ai_summary`, `ai_tags` y `documents.raw_text`.
- `RecruitmentIntelligenceEngine` interpreta la consulta y reordena resultados.

## Cuellos de botella encontrados

### Critico 1 - No hay prueba funcional del flujo completo

El repo compila, pero no tiene una prueba que valide:

- insertar una fuente configurada,
- sincronizar,
- guardar candidatos reales,
- abrir documentos,
- buscar por texto de CV.

Esto permite que haya commits que "mejoran" una parte sin confirmar que el producto final funcione.

### Critico 2 - Gmail procesa por tandas y no garantiza historico completo

Gmail tiene limites razonables para Render:

- `maxResults`: hasta 500 ids por pagina.
- `maxMessages`: hasta 120 correos por sincronizacion.
- `gmailBudgetMs`: por defecto 45 segundos.

El frontend ejecuta hasta 60 tandas cuando se sincroniza Gmail individualmente. Pero `Sincronizar todo` llama una sola vez a `/sync-all`, por lo que Gmail puede procesar solo una tanda dentro del flujo global.

Impacto: si hay 10.000 CVs, el flujo global no los trae todos en una sola accion.

### Critico 3 - El filtro de candidato real todavia permite falsos positivos y falsos negativos

El sistema intenta detectar personas reales con:

- nombre probable,
- email,
- telefono,
- documento,
- texto de CV.

Pero un email de sistema con adjunto o un nombre derivado del asunto puede pasar. Tambien un CV valido sin email/telefono puede quedar con nombre malo si el parser no extrae bien el nombre.

Impacto: aparecen candidatos como "The Google Cloud Team" y al mismo tiempo se omiten candidatos reales.

### Critico 4 - El ranking no usa suficiente informacion enriquecida del CV

`findCandidates()` busca dentro de `documents.raw_text`, pero `candidateRanker.ts` explica y reordena usando principalmente:

- nombre,
- rol,
- ciudad,
- tags,
- seniority.

No reusa el texto completo de documentos para explicar coincidencias como "ingles", "abogado", experiencia o herramientas.

Impacto: puede encontrar por SQL, pero ordenar y explicar mal.

### Critico 5 - Buscojobs no tiene endpoint confirmado de postulantes

El conector prueba muchas rutas probables:

- ofertas activas,
- postulaciones,
- postulantes,
- candidatos,
- curriculums.

Pero el sistema depende de que la API real de Buscojobs coincida con esas rutas o de tener una llamada Fetch/XHR correcta.

Impacto: puede iniciar sesion, ver ofertas, pero detectar 0 postulantes reales.

### Alto 6 - AGLH y Yoiners son conectores genericos, no conectores de producto

Ambos usan `scrapeGenericWebSource()`. Eso significa que dependen de:

- URL base,
- URL login,
- usuario/contrasena,
- URLs donde buscar candidatos,
- patron de links.

No existe todavia conocimiento especifico de cada plataforma.

Impacto: pueden decir "requiere manual login" o "0 registros" sin resolver el negocio.

### Alto 7 - LinkedIn Recruiter esta listado pero no implementado

Existe en `DEFAULT_INTEGRATIONS`, pero no esta en `AGENTS`.

Impacto: el producto sugiere una fuente que no puede sincronizar.

### Alto 8 - Migraciones duplicadas con numero 008

Existen:

- `008_cleanup_false_gmail_candidates.sql`
- `008_cleanup_false_gmail_system_candidates.sql`

El sistema las ejecuta por nombre completo, asi que no necesariamente rompe, pero indica desorden de deuda y dificulta razonar sobre que limpieza se aplico.

### Alto 9 - UI con textos codificados mal

Hay caracteres rotos como `ConfiguraciÃ³n`, `ContraseÃ±a`, `bÃºsqueda`, etc.

Impacto: baja confianza del usuario y hace que el producto parezca inestable aunque el backend funcione.

### Medio 10 - Hay componentes duplicados/no usados

En `frontend/src/App.tsx` existen `IntegrationConfigPanelV2` y tambien `IntegrationConfigPanel`. El segundo parece legado y no se usa en el flujo actual.

Impacto: aumenta confusion y riesgo de arreglar el componente equivocado.

## Modulos por estado

### Mas terminados

- Autenticacion JWT.
- Modelo base de candidatos/documentos/fuentes.
- Servicio central `importCandidate()`.
- Descarga de adjuntos Gmail por API.
- Migraciones automaticas en deploy.
- Busqueda SQL sobre candidatos y documentos.

### Incompletos

- Pruebas funcionales.
- Validacion real de punta a punta.
- Extraccion robusta de nombre/rol/idioma/experiencia desde CV.
- Sincronizacion historica completa de Gmail desde "Sincronizar todo".
- Conector real de Buscojobs postulantes.
- Conectores especificos de AGLH y Yoiners.
- LinkedIn Recruiter.

### Duplicados o deuda

- Migraciones duplicadas `008`.
- Dos paneles de configuracion de integraciones.
- Logica de busqueda expandida duplicada en `candidates.ts` y `search.ts`.
- Logica de normalizacion de candidatos repartida entre `integrations.ts`, `candidates.ts` y `candidateIngestion.ts`.

## Decision tecnica inmediata

Antes de seguir arreglando conectores aislados, hay que agregar pruebas funcionales del producto con datos controlados.

La primera prueba debe demostrar:

1. Un candidato con CV se importa.
2. El documento queda disponible.
3. `GET /candidates` lo muestra.
4. `GET /candidates/:id` devuelve documentos.
5. `POST /search/talent` encuentra "abogado con ingles" usando el texto del CV.

Despues de esa red minima, recien corresponde corregir:

1. extraccion de CV,
2. ranking,
3. UI de lectura/descarga,
4. sincronizacion historica por lotes.

## Cambios aplicados despues de la auditoria inicial

- Se agrego la primera prueba automatica de flujo de busqueda: interpreta "abogado con ingles" y prioriza un candidato con evidencia en CV/documento.
- Talent Finder ahora recibe metadata de documentos desde el backend: cantidad de documentos, fuente primaria y snippet documental.
- El ranking ahora usa texto de documentos y premia candidatos con CV/documentos disponibles.
- "Sincronizar todo" ahora continua Gmail por tandas extra cuando Gmail informa que quedan correos pendientes o que corto por tiempo.
- Gmail endurecio el filtro para no importar correos administrativos si no tienen senales reales de candidato/CV.
- Se agrego una migracion nueva para limpiar candidatos falsos administrativos de Gmail ya creados.

## Estado actual contra definicion de terminado

No terminado.

Motivo:

- La red automatica todavia cubre busqueda/ranking, pero falta cubrir "sincronizar -> guardar -> listar -> abrir CV" con base de prueba.
- Gmail ya tiene tandas desde "Sincronizar todo", pero falta validar contra produccion y confirmar que procesa el volumen real esperado.
- Buscojobs todavia no trae postulantes reales de forma confiable.
- AGLH/Yoiners no tienen conectores especificos.
- La busqueda ya usa contenido documental, pero falta probarla con candidatos reales importados desde todas las fuentes.
