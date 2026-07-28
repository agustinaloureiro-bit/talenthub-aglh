import "dotenv/config";
import { pool, q } from "../db/pool.js";
import { searchTalent } from "../routes/search.js";

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
  const queries = [
    "abogado con ingles",
    "ventas y gastronomia",
    "administrativo con experiencia en facturacion, debe vivir en Carrasco o alrededores",
    "carga y descarga de mercaderia en Montevideo",
    "operario de fabrica, debe vivir cerca del Prado",
    "chofer de ambulancia con experiencia en traslado de pacientes"
  ];
  const searches = [];
  for (const query of queries) {
    const startedAt = Date.now();
    const result = await searchTalent(query, { activeOnly: true });
    searches.push({
      query,
      total: result.data.length,
      durationMs: Date.now() - startedAt,
      results: result.data.slice(0, 5).map((candidate) => ({
        name: candidate.fullName,
        score: candidate.score,
        role: candidate.currentRole,
        documents: candidate.documentCount,
        reason: candidate.matchReason
      }))
    });
  }
  process.stdout.write(`${JSON.stringify({
    metrics: metrics.rows[0],
    sources: sourceMetrics.rows,
    documents: documentMetrics.rows[0],
    searches
  }, null, 2)}\n`);
} finally {
  await pool.end();
}
