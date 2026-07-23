import "dotenv/config";
import { pool, q } from "../db/pool.js";
import { analyzeCvText } from "../services/cvAnalysis.js";

const batchSize = Math.max(10, Math.min(250, Number(process.argv.find((arg) => arg.startsWith("--batch="))?.split("=")[1] ?? 100)));
const maxCandidates = Math.max(1, Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 10000));
const technicalTag = /^(?:postgres|postgresql|database|supabase|render|gmail|google|drive|cv|curriculum|curriculo|currículo|currículum|vitae|pdf|doc|docx|rtf|txt)$/i;

let cursor = "00000000-0000-0000-0000-000000000000";
let reviewed = 0;
let updated = 0;
let unreadable = 0;

try {
  while (reviewed < maxCandidates) {
    const remaining = Math.min(batchSize, maxCandidates - reviewed);
    const result = await q<any>(
      `SELECT c.id, c.email, c.phone, c.country, c."current_role", c.ai_tags,
              doc.id AS document_id, doc.raw_text,
              EXISTS (SELECT 1 FROM candidate_sources cs WHERE cs.candidate_id=c.id AND cs.source_type='gmail') AS from_gmail
       FROM candidates c
       JOIN LATERAL (
         SELECT d.id, d.raw_text
         FROM documents d
         WHERE d.candidate_id=c.id AND length(coalesce(d.raw_text,'')) >= 80
         ORDER BY d.is_primary_cv DESC, d.created_at DESC
         LIMIT 1
       ) doc ON true
       WHERE c.duplicate_of IS NULL AND c.status='active' AND c.id > $1::uuid
       ORDER BY c.id
       LIMIT $2`,
      [cursor, remaining]
    );
    if (!result.rows.length) break;

    for (const row of result.rows) {
      cursor = row.id;
      reviewed += 1;
      const analysis = analyzeCvText(row.raw_text ?? "");
      if (!analysis.hasReadableText) {
        unreadable += 1;
        continue;
      }
      const tags = [...new Set([...(row.ai_tags ?? []).filter((tag: string) => !technicalTag.test(tag)), ...analysis.roles, ...analysis.skills, ...analysis.languages.map((item) => item.lang)])];
      const qualityScore = Math.min(100,
        20
        + (row.email?.length ? 15 : 0)
        + (row.phone?.length ? 15 : 0)
        + 15
        + (analysis.roles.length ? 15 : 0)
        + (analysis.experienceHighlights.length ? 10 : 0)
        + (analysis.educationHighlights.length ? 5 : 0)
        + (analysis.languages.length ? 5 : 0)
      );
      const country = analysis.country ?? (row.from_gmail && row.country === "Uruguay" ? null : row.country);
      const currentRole = analysis.primaryRole ?? (technicalTag.test(row.current_role ?? "") ? null : row.current_role);
      await q(
        `UPDATE candidates SET
           "current_role"=$1,
           city=coalesce($2, city),
           country=$3,
           ai_seniority_years=coalesce($4, ai_seniority_years),
           ai_tags=$5,
           ai_languages=case when jsonb_array_length($6::jsonb) > 0 then $6::jsonb else ai_languages end,
           ai_summary=$7,
           quality_score=$8,
           updated_at=now()
         WHERE id=$9`,
        [currentRole, analysis.city, country, analysis.years, tags, JSON.stringify(analysis.languages), analysis.summary, qualityScore, row.id]
      );
      await q("UPDATE documents SET ai_summary=$1, processed_at=now() WHERE id=$2", [analysis.summary, row.document_id]);
      updated += 1;
    }
    process.stdout.write(`Revisados ${reviewed}; actualizados ${updated}; sin texto confiable ${unreadable}.\n`);
  }
} finally {
  await pool.end();
}

process.stdout.write(`Finalizado. Revisados ${reviewed}; actualizados ${updated}; sin texto confiable ${unreadable}.\n`);
