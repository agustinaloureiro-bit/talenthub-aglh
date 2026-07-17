import "dotenv/config";
import { pool, q } from "../db/pool.js";
import { isClearlyGenericCandidateName } from "../routes/integrations.js";

try {
  const candidates = await q<{ id: string; full_name: string }>(
    `SELECT id, full_name
     FROM candidates
     WHERE duplicate_of IS NULL AND status = 'active'`
  );
  const rejected = candidates.rows.filter((candidate) => isClearlyGenericCandidateName(candidate.full_name));

  if (rejected.length) {
    await q(
      `UPDATE candidates
       SET status = 'rejected', updated_at = now()
       WHERE id = ANY($1::uuid[])`,
      [rejected.map((candidate) => candidate.id)]
    );
  }

  process.stdout.write(`${JSON.stringify({ reviewed: candidates.rows.length, rejected: rejected.length, names: rejected.map((candidate) => candidate.full_name) }, null, 2)}\n`);
} finally {
  await pool.end();
}
