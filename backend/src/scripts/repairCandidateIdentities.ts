import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pool, q } from "../db/pool.js";
import { extractCandidateNameEvidence, normalizedCandidateName, shouldReplaceCandidateName } from "../services/candidateName.js";
import { candidateNameLooksReal, cleanCandidateNameText } from "../routes/integrations.js";

const applyNames = process.argv.includes("--apply-names");
const applyDuplicates = process.argv.includes("--apply-duplicates");
const rollbackRepairId = process.argv.find((arg) => arg.startsWith("--rollback-names="))?.split("=")[1] ?? null;
const apply = applyNames || applyDuplicates;
const repairId = applyNames ? randomUUID() : null;
const batchSize = Math.max(20, Math.min(500, Number(process.argv.find((arg) => arg.startsWith("--batch="))?.split("=")[1] ?? 200)));
const maxCandidates = Math.max(1, Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 50000));
const sampleSize = Math.max(0, Math.min(50, Number(process.argv.find((arg) => arg.startsWith("--samples="))?.split("=")[1] ?? 0)));

let reviewed = 0;
let proposedNameRepairs = 0;
let appliedNameRepairs = 0;
let normalizedOnlyDifferences = 0;
let safeNameRepairs = 0;
let conflictingNamesHeldForReview = 0;
let cursor = "00000000-0000-0000-0000-000000000000";
const safeSamples: Array<{ stored: string; proposed: string; source: string; emailSupported: boolean }> = [];
const heldSamples: Array<{ stored: string; proposed: string; source: string; emailSupported: boolean }> = [];

async function reviewNames() {
  while (reviewed < maxCandidates) {
    const result = await q<{ id: string; full_name: string; email: string[]; raw_text: string }>(
      `SELECT c.id, c.full_name, c.email, d.raw_text
       FROM candidates c
       JOIN LATERAL (
         SELECT raw_text
         FROM documents
         WHERE candidate_id=c.id
           AND (is_primary_cv OR lower(type) IN ('cv','resume','curriculum'))
           AND length(coalesce(raw_text,'')) >= 80
         ORDER BY is_primary_cv DESC, processed_at DESC NULLS LAST, created_at DESC
         LIMIT 1
       ) d ON true
       WHERE c.duplicate_of IS NULL AND c.status='active' AND c.id>$1::uuid
       ORDER BY c.id
       LIMIT $2`,
      [cursor, Math.min(batchSize, maxCandidates - reviewed)]
    );
    if (!result.rows.length) break;

    const repairs: Array<{ id: string; previousName: string; name: string; source: string }> = [];
    for (const row of result.rows) {
      cursor = row.id;
      reviewed += 1;
      const evidence = extractCandidateNameEvidence(row.raw_text, cleanCandidateNameText, candidateNameLooksReal);
      if (!evidence || evidence.confidence < 90 || evidence.value === row.full_name) continue;
      proposedNameRepairs += 1;
      if (normalizedCandidateName(evidence.value) === normalizedCandidateName(row.full_name)) {
        normalizedOnlyDifferences += 1;
        continue;
      }
      if (shouldReplaceCandidateName(row.full_name, evidence, row.email ?? [], candidateNameLooksReal)) {
        safeNameRepairs += 1;
        if (safeSamples.length < sampleSize) {
          safeSamples.push({
            stored: row.full_name,
            proposed: evidence.value,
            source: evidence.source,
            emailSupported: evidence.source === "cv_label" || (row.email ?? []).some((email) => {
              const local = email.split("@")[0]?.toLowerCase() ?? "";
              return normalizedCandidateName(evidence.value).split(" ").some((word) => word.length >= 3 && local.includes(word));
            })
          });
        }
        repairs.push({ id: row.id, previousName: row.full_name, name: evidence.value, source: evidence.source });
      } else {
        conflictingNamesHeldForReview += 1;
        if (heldSamples.length < sampleSize) {
          heldSamples.push({
            stored: row.full_name,
            proposed: evidence.value,
            source: evidence.source,
            emailSupported: false
          });
        }
      }
    }
    if (applyNames && repairId && repairs.length) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO candidate_identity_repair_backups
             (repair_id, candidate_id, previous_full_name, proposed_full_name, evidence_source, applied_at)
           SELECT $1::uuid, v.id, v.previous_full_name, v.full_name, v.evidence_source, now()
           FROM jsonb_to_recordset($2::jsonb)
             AS v(id uuid, previous_full_name text, full_name text, evidence_source text)`,
          [repairId, JSON.stringify(repairs.map((repair) => ({
            id: repair.id,
            previous_full_name: repair.previousName,
            full_name: repair.name,
            evidence_source: repair.source
          })))]
        );
        await client.query(
          `UPDATE candidates c
           SET full_name=v.full_name, updated_at=now()
           FROM jsonb_to_recordset($1::jsonb) AS v(id uuid, full_name text)
           WHERE c.id=v.id`,
          [JSON.stringify(repairs.map((repair) => ({ id: repair.id, full_name: repair.name })))]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      appliedNameRepairs += repairs.length;
    }
  }
}

type DuplicatePair = { keeper_id: string; duplicate_id: string; reason: string };

async function exactDuplicatePairs() {
  const result = await q<DuplicatePair>(
    `WITH exact_evidence AS (
       SELECT DISTINCT c.id AS candidate_id,
              'document:' || d.file_hash AS identity_key,
              'same_cv'::text AS reason,
              c.quality_score,
              c.updated_at
       FROM candidates c
       JOIN documents d ON d.candidate_id=c.id
       WHERE c.duplicate_of IS NULL AND c.status='active'
         AND d.is_primary_cv AND d.file_hash IS NOT NULL AND length(d.file_hash)>=20
       UNION ALL
       SELECT DISTINCT c.id,
              'source:' || cs.source_type || ':' || cs.source_id,
              'same_source'::text,
              c.quality_score,
              c.updated_at
       FROM candidates c
       JOIN candidate_sources cs ON cs.candidate_id=c.id
       WHERE c.duplicate_of IS NULL AND c.status='active'
         AND cs.source_id IS NOT NULL AND length(cs.source_id)>=3
     ), grouped AS (
       SELECT *, count(*) OVER (PARTITION BY identity_key) AS identity_count,
              first_value(candidate_id) OVER (
                PARTITION BY identity_key
                ORDER BY quality_score DESC, updated_at DESC, candidate_id
              ) AS keeper_id
       FROM exact_evidence
     )
     SELECT DISTINCT ON (candidate_id)
            keeper_id, candidate_id AS duplicate_id, reason
     FROM grouped
     WHERE identity_count>1 AND candidate_id<>keeper_id
     ORDER BY candidate_id, CASE reason WHEN 'same_cv' THEN 0 ELSE 1 END`,
    []
  );
  return result.rows;
}

async function mergeExactDuplicate(pair: DuplicatePair) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<{ id: string }>(
      `SELECT id FROM candidates
       WHERE id=ANY($1::uuid[]) AND duplicate_of IS NULL
       ORDER BY id FOR UPDATE`,
      [[pair.keeper_id, pair.duplicate_id]]
    );
    if (locked.rows.length !== 2) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      `UPDATE candidates keeper SET
         email=coalesce((SELECT array_agg(DISTINCT item) FROM unnest(coalesce(keeper.email,'{}'::text[]) || coalesce(duplicate.email,'{}'::text[])) item), '{}'::text[]),
         phone=coalesce((SELECT array_agg(DISTINCT item) FROM unnest(coalesce(keeper.phone,'{}'::text[]) || coalesce(duplicate.phone,'{}'::text[])) item), '{}'::text[]),
         ai_tags=coalesce((SELECT array_agg(DISTINCT item) FROM unnest(coalesce(keeper.ai_tags,'{}'::text[]) || coalesce(duplicate.ai_tags,'{}'::text[])) item), '{}'::text[]),
         quality_score=greatest(keeper.quality_score, duplicate.quality_score),
         updated_at=now()
       FROM candidates duplicate
       WHERE keeper.id=$1 AND duplicate.id=$2`,
      [pair.keeper_id, pair.duplicate_id]
    );
    await client.query("UPDATE candidate_sources SET candidate_id=$1 WHERE candidate_id=$2", [pair.keeper_id, pair.duplicate_id]);
    await client.query(
      `DELETE FROM documents duplicate
       USING documents keeper
       WHERE duplicate.candidate_id=$2 AND keeper.candidate_id=$1
         AND duplicate.file_hash IS NOT NULL AND duplicate.file_hash=keeper.file_hash`,
      [pair.keeper_id, pair.duplicate_id]
    );
    await client.query("UPDATE documents SET candidate_id=$1 WHERE candidate_id=$2", [pair.keeper_id, pair.duplicate_id]);
    for (const table of ["candidate_work_history", "candidate_education", "candidate_processes", "interviews", "evaluations"]) {
      await client.query(`UPDATE ${table} SET candidate_id=$1 WHERE candidate_id=$2`, [pair.keeper_id, pair.duplicate_id]);
    }
    await client.query("UPDATE intelligence_search_results SET candidate_id=$1 WHERE candidate_id=$2", [pair.keeper_id, pair.duplicate_id]);
    await client.query("UPDATE agent_candidate_cache SET candidate_id=$1 WHERE candidate_id=$2", [pair.keeper_id, pair.duplicate_id]);
    await client.query(
      `UPDATE candidates SET duplicate_of=$1, is_canonical=false, status='duplicate', updated_at=now()
       WHERE id=$2`,
      [pair.keeper_id, pair.duplicate_id]
    );
    await client.query(
      `UPDATE candidates SET source_count=(
         SELECT count(DISTINCT source_type)::int FROM candidate_sources WHERE candidate_id=$1
       ) WHERE id=$1`,
      [pair.keeper_id]
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

let duplicatePairs: DuplicatePair[] = [];
let mergedDuplicates = 0;
try {
  if (rollbackRepairId) {
    const restored = await q(
      `WITH restored AS (
         UPDATE candidates c
         SET full_name=b.previous_full_name, updated_at=now()
         FROM candidate_identity_repair_backups b
         WHERE b.repair_id=$1::uuid AND b.candidate_id=c.id AND b.reverted_at IS NULL
         RETURNING b.candidate_id
       )
       UPDATE candidate_identity_repair_backups b
       SET reverted_at=now()
       WHERE b.repair_id=$1::uuid AND b.candidate_id IN (SELECT candidate_id FROM restored)
       RETURNING b.candidate_id`,
      [rollbackRepairId]
    );
    process.stdout.write(`${JSON.stringify({ mode: "rollback-names", repairId: rollbackRepairId, restoredNames: restored.rowCount }, null, 2)}\n`);
    process.exitCode = 0;
  } else {
  await reviewNames();
  duplicatePairs = await exactDuplicatePairs();
  if (applyDuplicates) {
    for (const pair of duplicatePairs) {
      if (await mergeExactDuplicate(pair)) mergedDuplicates += 1;
    }
  }
  process.stdout.write(`${JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    repairId,
    applyNames,
    applyDuplicates,
    reviewed,
    proposedNameRepairs,
    normalizedOnlyDifferences,
    safeNameRepairs,
    conflictingNamesHeldForReview,
    appliedNameRepairs,
    exactDuplicatePairs: duplicatePairs.length,
    mergedDuplicates,
    ...(sampleSize ? { safeSamples, heldSamples } : {})
  }, null, 2)}\n`);
  }
} finally {
  await pool.end();
}
