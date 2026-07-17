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
  const queries = ["abogado con ingles", "ventas y gastronomia"];
  const searches = [];
  for (const query of queries) {
    const result = await searchTalent(query, { activeOnly: true });
    searches.push({
      query,
      results: result.data.slice(0, 5).map((candidate) => ({
        name: candidate.fullName,
        score: candidate.score,
        role: candidate.currentRole,
        documents: candidate.documentCount,
        reason: candidate.matchReason
      }))
    });
  }
  process.stdout.write(`${JSON.stringify({ metrics: metrics.rows[0], searches }, null, 2)}\n`);
} finally {
  await pool.end();
}
