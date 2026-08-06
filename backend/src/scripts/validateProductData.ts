import "dotenv/config";
import { pool, q } from "../db/pool.js";
import { searchTalent } from "../routes/search.js";

// Keep the report machine-readable while the search engine emits timing diagnostics.
console.log = () => undefined;
console.info = () => undefined;

try {
  const metrics = await q<any>(
    `SELECT
       count(*) FILTER (WHERE c.duplicate_of IS NULL AND c.status='active')::int AS active_candidates,
       count(*) FILTER (WHERE c.duplicate_of IS NULL AND c.status='active' AND EXISTS (SELECT 1 FROM documents d WHERE d.candidate_id=c.id))::int AS candidates_with_documents,
       count(*) FILTER (WHERE c.duplicate_of IS NULL AND c.status='active' AND nullif(c.ai_summary,'') IS NOT NULL)::int AS candidates_with_summary,
       count(*) FILTER (WHERE c.duplicate_of IS NULL AND c.status='active' AND jsonb_array_length(coalesce(c.ai_languages,'[]'::jsonb)) > 0)::int AS candidates_with_languages
     FROM candidates c`
  );
  const sourceMetrics = await q<any>(
    `SELECT cs.source_type,
       count(DISTINCT cs.candidate_id)::int AS candidates,
       count(DISTINCT d.id)::int AS documents,
       max(cs.source_created_at) AS newest_source_record
     FROM candidate_sources cs
     JOIN candidates c ON c.id=cs.candidate_id
     LEFT JOIN documents d ON d.candidate_id=c.id AND d.source_type=cs.source_type
     WHERE cs.is_active=true AND c.duplicate_of IS NULL AND c.status='active'
     GROUP BY cs.source_type
     ORDER BY candidates DESC`
  );
  const documentMetrics = await q<any>(
    `SELECT
       count(*)::int AS documents,
       count(*) FILTER (WHERE nullif(raw_text, '') IS NULL)::int AS without_text,
       count(*) FILTER (WHERE nullif(file_url, '') IS NULL AND nullif(source_path, '') IS NULL)::int AS without_download_reference,
       count(*) FILTER (WHERE mime_type ILIKE '%pdf%' OR file_name ILIKE '%.pdf')::int AS pdf_documents,
       count(*) FILTER (WHERE mime_type ILIKE '%word%' OR file_name ILIKE '%.doc' OR file_name ILIKE '%.docx')::int AS word_documents
     FROM documents`
  );
  const unreadableDocumentsBySource = await q<any>(
    `SELECT source_type,
       count(*) FILTER (WHERE nullif(raw_text, '') IS NULL)::int AS without_text,
       count(*) FILTER (WHERE processed_at IS NULL)::int AS pending,
       count(*) FILTER (WHERE processed_at IS NOT NULL AND nullif(raw_text, '') IS NULL)::int AS processed_without_text,
       count(*) FILTER (WHERE extraction_last_error IS NOT NULL)::int AS extraction_errors,
       max(extraction_attempts)::int AS max_attempts,
       count(*)::int AS total
     FROM documents
     GROUP BY source_type
     ORDER BY without_text DESC`
  );
  const integrationMetrics = await q<any>(
    `SELECT id, status, last_sync_at, total_imported, updated_at
     FROM integrations
     WHERE id <> 'drive'
     ORDER BY id`
  );
  const gmailDateMetrics = await q<any>(
    `SELECT
       count(*)::int AS sources,
       count(*) FILTER (WHERE source_created_at IS NOT NULL)::int AS dated_sources,
       count(*) FILTER (WHERE source_created_at IS NULL AND source_data ? 'internalDate')::int AS recoverable_internal_dates,
       count(*) FILTER (WHERE source_created_at IS NULL AND source_data ? 'date')::int AS recoverable_takeout_dates
     FROM candidate_sources
     WHERE source_type='gmail' AND is_active=true`
  );
  const extractionErrorMetrics = await q<any>(
    `SELECT source_type,
       CASE
         WHEN extraction_last_error ILIKE '%no contiene texto legible%' THEN 'sin_texto_extraible'
         WHEN extraction_last_error ILIKE '%HTTP 404%' OR extraction_last_error ILIKE '%not found%' THEN 'archivo_no_encontrado'
         WHEN extraction_last_error ILIKE '%HTTP 401%' OR extraction_last_error ILIKE '%HTTP 403%' THEN 'acceso_remoto'
         WHEN extraction_last_error ILIKE '%timeout%' OR extraction_last_error ILIKE '%tiempo%' THEN 'timeout'
         WHEN extraction_last_error IS NULL THEN 'sin_error'
         ELSE 'otro'
       END AS category,
       count(*)::int AS documents
     FROM documents
     WHERE nullif(raw_text, '') IS NULL
     GROUP BY source_type, category
     ORDER BY source_type, documents DESC`
  );
  const queries = [
    "abogado con ingles",
    "ventas y gastronomia",
    "auxiliar administrativo con experiencia en un sistema de facturacion, debe vivir cerca de Carrasco",
    "carga y descarga de mercaderia en Montevideo",
    "operario de fabrica, debe vivir cerca del Prado",
    "chofer de ambulancia con experiencia en traslado de pacientes",
    "telemarketer con 3 años de experiencia en el area",
    "Estudiante de Contador, Administracion de empresas o Economia con 3 años de experiencia en tareas administrativas",
    "Maquinista de refrigeracion industrial con experiencia en mantenimiento, Freon o amoniaco, para trabajar en Las Piedras",
    "Mecanico industrial con experiencia en mantenimiento de autoelevadores, hidraulica y electricidad",
    "Vendedor de terreno para reventa de lubricantes, con gestion de cartera y visitas comerciales"
  ];
  const searches = [];
  for (const query of process.env.VALIDATE_SKIP_SEARCHES === "1" ? [] : queries) {
    const startedAt = Date.now();
    try {
      const result = await searchTalent(query, { activeOnly: true });
      searches.push({
        query,
        total: result.data.length,
        durationMs: Date.now() - startedAt,
        results: result.data.slice(0, 5).map((candidate) => ({
          name: candidate.fullName,
          score: candidate.score,
          role: candidate.currentRole,
          location: [candidate.city, candidate.country].filter(Boolean).join(", "),
          sources: candidate.sourceTypes,
          documents: candidate.documentCount,
          reason: candidate.matchReason
        }))
      });
    } catch (error: any) {
      searches.push({
        query,
        total: 0,
        durationMs: Date.now() - startedAt,
        error: String(error?.message ?? error),
        results: []
      });
    }
  }
  process.stdout.write(`${JSON.stringify({
    metrics: metrics.rows[0],
    sources: sourceMetrics.rows,
    documents: documentMetrics.rows[0],
    unreadableDocumentsBySource: unreadableDocumentsBySource.rows,
    integrations: integrationMetrics.rows,
    gmailDates: gmailDateMetrics.rows[0],
    extractionErrors: extractionErrorMetrics.rows,
    searches
  }, null, 2)}\n`);
} finally {
  await pool.end();
}
