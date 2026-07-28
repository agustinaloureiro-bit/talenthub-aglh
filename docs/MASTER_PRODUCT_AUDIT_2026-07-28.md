# Auditoria maestra de TalentHub AGLH

Fecha: 28 de julio de 2026

## 1. Resumen ejecutivo

TalentHub ya tiene una base funcional valiosa: centraliza candidatos reales,
conserva documentos, sincroniza cuatro fuentes productivas y permite buscar
evidencia laboral desde una sola interfaz. No es un mockup.

El producto todavia no alcanzo el nivel enterprise definido. El mayor problema
encontrado no era la cantidad de candidatos, sino la cobertura del indice:
la recuperacion inicial consultaba principalmente el resumen de la ficha y no
todos los documentos asociados. Ademas, un fallo temporal al descargar un CV
remoto podia marcarlo como procesado y excluirlo de futuros reintentos.

Esta entrega corrige ambos cuellos de botella:

- Talent Finder recupera coincidencias desde candidatos y desde todos los CV.
- Se presenta el documento que produjo la coincidencia, no necesariamente el
  ultimo documento cargado.
- Los CV remotos fallidos vuelven a una cola incremental.
- AGLH, Yoiners y Buscojobs pueden renovar y conservar la sesion durante la
  reparacion.
- Las fallas de red o autenticacion ya no se registran como analisis terminado.

### Evidencia productiva

Validacion directa contra PostgreSQL:

- 22.825 candidatos activos.
- 22.824 candidatos con al menos un documento.
- 24.839 documentos.
- 19.358 candidatos de AGLH.
- 1.868 candidatos de Yoiners.
- 1.729 candidatos de Gmail.
- 334 candidatos de Buscojobs.
- 34 candidatos historicos de Drive.

Consultas verificadas:

| Consulta | Resultados | Tiempo |
| --- | ---: | ---: |
| abogado con ingles | 194 | 3,4 s |
| ventas y gastronomia | 318 | 3,1 s |
| administrativo con facturacion cerca de Carrasco | 1 | 4,5 s |
| carga y descarga de mercaderia en Montevideo | 114 | 4,4 s |
| operario de fabrica cerca del Prado | 4 | 3,2 s |
| chofer de ambulancia con traslado de pacientes | 2 | 1,6 s |

Los primeros resultados de abogado con ingles contienen simultaneamente la
profesion y el idioma. Carga y descarga devuelve perfiles de logistica con
evidencia y ubicacion explicada. La consulta de Carrasco tiene cobertura baja:
es una limitacion real de la evidencia estructurada disponible, no una razon
para inventar candidatos.

## 2. Mapa del producto

### Sincronizacion

1. El recruiter presiona `Sincronizar`.
2. `POST /api/integrations/sync-all` selecciona las fuentes configuradas.
3. Cada conector renueva su sesion si puede hacerlo con las credenciales
   guardadas.
4. El conector usa su cursor y recupera registros nuevos o modificados.
5. Cada fila pasa por validacion de persona real y presencia de CV.
6. `importCandidate` normaliza identidad, fuente, contactos y documento.
7. La huella de contenido evita reprocesar registros sin cambios.
8. La deduplicacion une solamente identidades corroboradas.
9. El texto del CV alimenta resumen, rol, ubicacion, idiomas y etiquetas.
10. PostgreSQL actualiza el vector persistido y los indices GIN.
11. El reparador toma un lote acotado de CV historicos pendientes.
12. La UI muestra nuevos, actualizados, sin cambios, errores y diagnostico.

### Busqueda

1. El recruiter describe la necesidad en lenguaje natural.
2. El interprete separa roles, competencias, idiomas y ubicacion del ruido como
   salario, horario, nombre del cliente o frases de relleno.
3. La recuperacion consulta el vector persistido del candidato.
4. En paralelo consulta el texto indexado de todos sus documentos.
5. Une ambos conjuntos y selecciona el CV con la evidencia mas relevante.
6. El ranking comprueba requisitos obligatorios e incompatibilidades.
7. Aplica distancia geografica cuando existe una residencia confiable.
8. Explica por que aparece cada candidato y pagina el resultado.
9. El recruiter previsualiza o descarga el CV sin perder la busqueda.

## 3. Hallazgos criticos

### C1. Cobertura documental incompleta

**Problema:** la consulta inicial dependia demasiado de `candidates.search_vector`.
Una competencia presente en un CV secundario podia no participar.

**Impacto:** falsos ceros y candidatos existentes imposibles de encontrar.

**Solucion implementada:** recuperacion hibrida desde candidatos y todos los
documentos, seleccionando el documento que produjo el match.

**Validacion:** seis consultas reales y 134 pruebas automatizadas.

### C2. CV remotos cerrados despues de un fallo transitorio

**Problema:** un timeout o una sesion vencida podia establecer `processed_at`
sin haber leido el archivo.

**Impacto:** perdida silenciosa y permanente de informacion buscable.

**Solucion implementada:** solo se cierra un documento cuando sus bytes fueron
leidos. Se agregaron reintentos autenticados de Yoiners y Buscojobs y se
reencolan referencias remotas historicas.

### C3. Historico sin texto completo

**Problema:** 21.642 documentos no tienen `raw_text`; todos conservan una
referencia de descarga y gran parte de sus candidatos tiene resumen.

**Impacto:** la ficha puede existir y ser buscable por resumen, pero una
competencia que solo aparece en el archivo original puede quedar fuera.

**Estado:** mitigado, no resuelto completamente. La migracion reabre la cola y
cada sincronizacion repara lotes. Procesar decenas de miles en una sola
solicitud no es seguro para Render ni para las plataformas de origen.

**Siguiente solucion:** trabajo de backfill en segundo plano, con concurrencia,
reintentos exponenciales, progreso por fuente y pausa automatica ante limites.

### C4. Credenciales de integraciones sin cifrado de aplicacion

**Problema:** contrasenas, cookies y refresh tokens viven en JSONB. Se ocultan
en la API, pero no existe cifrado por campo verificable en el codigo.

**Impacto:** una filtracion de base de datos expone accesos de terceros.

**Siguiente solucion:** cifrado autenticado por campo con una clave exclusiva
en Render, rotacion y registro de accesos. No debe implementarse sin migracion
reversible y respaldo.

## 4. Hallazgos importantes

### I1. Latencia de busqueda

La busqueda productiva tarda entre 1,6 y 4,5 segundos. Es util, pero el objetivo
operativo debe ser menos de dos segundos en percentil 95.

Acciones:

- medir `EXPLAIN ANALYZE` de consultas frecuentes;
- persistir una columna `documents.search_vector` en vez de repetir la
  expresion en la consulta;
- limitar candidatos antes de hidratar contactos y documentos;
- cachear por version del indice, consulta y filtros.

### I2. Modulos demasiado grandes

`routes/integrations.ts` y `frontend/src/App.tsx` concentran muchas
responsabilidades. Esto aumenta regresiones y dificulta pruebas aisladas.

Acciones:

- un servicio por fuente;
- orquestador de sincronizacion independiente;
- cola de reparacion independiente;
- vistas de frontend por dominio;
- componentes compartidos para filtros, candidatos y documentos.

### I3. Observabilidad insuficiente

Existen logs de sincronizacion y health check, pero no metricas persistidas de
latencia, cobertura documental, fallos por endpoint ni calidad de extraccion.

Acciones:

- tablero tecnico con cobertura por fuente;
- alertas por caida de volumen, 401/403, timeout y cero resultados anomalo;
- trazas con identificadores, nunca con tokens ni contenido sensible.

### I4. Deduplicacion sin revision humana

La deduplicacion automatica es conservadora, lo cual evita unir homonimos, pero
los casos ambiguos no tienen bandeja de revision.

Acciones:

- sugerencias explicables de posible duplicado;
- comparar email, telefono, hash de CV, fuente y nombre;
- nunca unir por nombre comun solamente;
- permitir confirmar, rechazar y deshacer.

### I5. Persistencia estructurada parcial

Rol, ubicacion, idiomas y resumen estan cubiertos, pero experiencia, educacion,
disponibilidad y fecha de vigencia no son uniformes en todas las fuentes.

Acciones:

- esquema de evidencias con valor, origen, pagina y confianza;
- conservar el texto original como fuente de verdad;
- mostrar `Sin declarar` cuando no existe evidencia;
- nunca completar por inferencia demografica o invencion.

## 5. Hallazgos menores

- Existe codigo historico de Drive aunque la fuente ya no se muestra.
- Los textos y etiquetas todavia tienen algunos caracteres de codificacion
  heredados.
- Las versiones del motor estan escritas manualmente.
- Faltan pruebas visuales responsive y de accesibilidad automatizadas.
- La construccion Docker usa `npm install` en vez de instalaciones bloqueadas.

## 6. Mejoras de UX

Prioridad:

1. Estado global simple: fuente, ultima sincronizacion, nuevos y accion concreta.
2. Resultados con rol, ubicacion, contacto, antiguedad y evidencia antes de tags.
3. Panel lateral de CV que conserve consulta, pagina, filtros y orden.
4. Filtros progresivos: los frecuentes visibles; los demas en `Mas filtros`.
5. Explicar requisitos cumplidos, faltantes y desconocidos por separado.
6. Mostrar cobertura: `228 candidatos relacionados; 31 con ubicacion declarada`.
7. Evitar porcentajes absolutos cuando faltan datos esenciales.

## 7. Mejoras funcionales

- Backfill administrado y reanudable.
- Bandeja de documentos que no pudieron analizarse.
- Revision de posibles duplicados.
- Alertas de integracion vencida antes de una busqueda urgente.
- Busquedas guardadas y candidatos nuevos que ahora cumplen.
- Acciones de shortlist, contactar por WhatsApp y registrar resultado.
- Aprendizaje con feedback explicito del recruiter, no con inferencias opacas.

## 8. Mejoras tecnicas

- Extraer conectores y orquestador del router gigante.
- Cola durable para sincronizacion y extraccion.
- Versionar extractor y reanalizar solo versiones antiguas.
- Persistir evidencia estructurada por campo.
- Cifrar secretos de integraciones.
- JWT en cookie `httpOnly`, `secure` y `sameSite`, en lugar de `localStorage`.
- Pruebas end-to-end con PostgreSQL efimero y navegador en CI.
- Presupuesto de rendimiento y pruebas de carga.

## 9. Automatizaciones diferenciales

- Avisar cuando un candidato historico vuelve a ser relevante.
- Sugerir talento de busquedas anteriores ante una nueva vacante.
- Detectar fuentes con caida anormal de candidatos.
- Priorizar perfiles activos recientes entre candidatos igual de compatibles.
- Identificar datos faltantes que realmente cambian una decision.
- Crear una lista de contacto explicable, con aprobacion humana.

## 10. Roadmap priorizado

| Prioridad | Iniciativa | Impacto | Esfuerzo | Dependencias |
| --- | --- | --- | --- | --- |
| Critico | Backfill durable de 21.642 CV | Cobertura completa | Alto | Cola y limites por fuente |
| Critico | Cifrado de credenciales | Seguridad | Alto | Clave Render y migracion |
| Alto | `search_vector` persistido en documentos | Latencia y escala | Medio | Migracion PostgreSQL |
| Alto | E2E con base efimera | Evitar regresiones | Medio | CI |
| Alto | Evidencias estructuradas | Confianza del ranking | Alto | Version del extractor |
| Alto | Alertas y metricas por fuente | Operacion autonoma | Medio | Telemetria |
| Medio | Revision de duplicados | Calidad de datos | Medio | Modelo de decisiones |
| Medio | Busquedas guardadas y alertas | Productividad | Medio | Eventos de indice |
| Medio | Refactor por modulos | Mantenibilidad | Alto | Cobertura E2E |
| Bajo | Historial de acciones | Auditoria | Medio | Modelo de eventos |

## Criterio de terminado

Una version no se considera terminada por compilar. Debe cumplir:

1. sincronizar fuentes sin reprocesar historicos completos;
2. conservar o renovar sesiones cuando la plataforma lo permite;
3. importar solo personas reales con CV;
4. encontrar evidencia en cualquier documento;
5. no inventar datos faltantes;
6. explicar ubicacion, rol, idioma y competencias;
7. abrir el CV correcto;
8. conservar el contexto del recruiter;
9. pasar pruebas automatizadas;
10. validarse nuevamente en produccion.
