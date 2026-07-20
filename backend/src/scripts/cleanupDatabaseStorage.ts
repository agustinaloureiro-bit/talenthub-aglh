import "dotenv/config";
import { pool, q } from "../db/pool.js";

const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = 100;

type DuplicateRow = {
  id: string;
  keeper_id: string;
  duplicate_bytes: string | number | null;
  was_primary: boolean;
};

async function storageSnapshot() {
  const { rows } = await q<{
    documents: number;
    stored_bytes: string;
    physical_bytes: string;
    rejected_candidates: number;
  }>(`SELECT
      (SELECT count(*) FROM documents)::int AS documents,
      (SELECT coalesce(sum(octet_length(file_data)),0) FROM documents)::bigint AS stored_bytes,
      pg_total_relation_size('documents')::bigint AS physical_bytes,
      (SELECT count(*) FROM candidates WHERE status='rejected')::int AS rejected_candidates`);
  return rows[0];
}

async function duplicateRows() {
  const { rows } = await q<DuplicateRow>(`
    WITH identified AS (
      SELECT
        id,
        candidate_id,
        CASE
          WHEN nullif(file_hash,'') IS NOT NULL THEN 'hash:' || file_hash
          WHEN nullif(raw_text,'') IS NOT NULL THEN 'text:' || md5(raw_text)
          ELSE null
        END AS content_identity,
        octet_length(file_data) AS duplicate_bytes,
        is_primary_cv,
        created_at
      FROM documents
    ), ranked AS (
      SELECT
        *,
        first_value(id) OVER (
          PARTITION BY candidate_id, content_identity
          ORDER BY
            (duplicate_bytes IS NOT NULL) DESC,
            is_primary_cv DESC,
            created_at DESC NULLS LAST,
            id DESC
        ) AS keeper_id,
        row_number() OVER (
          PARTITION BY candidate_id, content_identity
          ORDER BY
            (duplicate_bytes IS NOT NULL) DESC,
            is_primary_cv DESC,
            created_at DESC NULLS LAST,
            id DESC
        ) AS position,
        bool_or(is_primary_cv) OVER (PARTITION BY candidate_id, content_identity) AS was_primary
      FROM identified
      WHERE content_identity IS NOT NULL
    )
    SELECT id, keeper_id, duplicate_bytes, was_primary
    FROM ranked
    WHERE position > 1
    ORDER BY keeper_id, id`);
  return rows;
}

async function deleteInBatches(rows: DuplicateRow[]) {
  const primaryKeepers = [...new Set(rows.filter((row) => row.was_primary).map((row) => row.keeper_id))];
  if (primaryKeepers.length) {
    await q("UPDATE documents SET is_primary_cv=true WHERE id=ANY($1::uuid[])", [primaryKeepers]);
  }

  let deleted = 0;
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const ids = rows.slice(start, start + BATCH_SIZE).map((row) => row.id);
    const result = await q<{ id: string }>("DELETE FROM documents WHERE id=ANY($1::uuid[]) RETURNING id", [ids]);
    deleted += result.rowCount ?? 0;
    if (deleted === rows.length || deleted % 500 === 0) {
      process.stdout.write(`Deleted duplicate documents: ${deleted}/${rows.length}\n`);
    }
  }
  return deleted;
}

async function cleanupRejectedCandidates() {
  const { rows } = await q<{ id: string }>("SELECT id FROM candidates WHERE status='rejected'");
  let deleted = 0;
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const ids = rows.slice(start, start + BATCH_SIZE).map((row) => row.id);
    const result = await q<{ id: string }>("DELETE FROM candidates WHERE id=ANY($1::uuid[]) RETURNING id", [ids]);
    deleted += result.rowCount ?? 0;
  }
  return deleted;
}

async function cleanupOldDiagnostics() {
  await q(`DELETE FROM sync_logs
    WHERE id NOT IN (SELECT id FROM sync_logs ORDER BY started_at DESC NULLS LAST LIMIT 50)`);
  await q(`DELETE FROM agent_runs
    WHERE id NOT IN (SELECT id FROM agent_runs ORDER BY started_at DESC NULLS LAST LIMIT 50)`);
  await q(`DELETE FROM saved_searches
    WHERE created_at < now() - interval '90 days'`);
}

try {
  const before = await storageSnapshot();
  const duplicates = await duplicateRows();
  const recoverableBytes = duplicates.reduce((sum, row) => sum + Number(row.duplicate_bytes ?? 0), 0);
  process.stdout.write(`${JSON.stringify({
    apply: APPLY,
    before,
    duplicateDocuments: duplicates.length,
    recoverableBytes
  })}\n`);

  if (!APPLY) process.exitCode = 2;
  else {
    const deletedDocuments = await deleteInBatches(duplicates);
    const deletedCandidates = await cleanupRejectedCandidates();
    await cleanupOldDiagnostics();
    const after = await storageSnapshot();
    process.stdout.write(`${JSON.stringify({ deletedDocuments, deletedCandidates, after })}\n`);
  }
} finally {
  await pool.end();
}
