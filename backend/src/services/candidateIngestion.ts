import type { CandidateImport } from "../agents/types.js";
import { q } from "../db/pool.js";

export type CandidateImportResult = "new" | "updated" | "skipped";

export type CandidateValidator = (candidate: CandidateImport, sourceType: string) => boolean;

function unique(values: string[]) {
  return [...new Set(values)];
}

function sanitizeEmails(values: string[] | undefined) {
  return unique((values ?? [])
    .map((value) => String(value).trim().toLowerCase())
    .filter((value) => value.length <= 254)
    .filter((value) => /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value)));
}

function sanitizePhones(values: string[] | undefined) {
  return unique((values ?? [])
    .map((value) => String(value).replace(/[^\d+]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((value) => {
      const digits = value.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) return false;
      if (/^0+$/.test(digits)) return false;
      if (/^(\d)\1{6,}$/.test(digits)) return false;
      if (/^(?:19|20)\d{6}(?:\d{4,6})?$/.test(digits)) return false;
      return true;
    }));
}

function sanitizeCandidate(candidate: CandidateImport): CandidateImport {
  return {
    ...candidate,
    email: sanitizeEmails(candidate.email),
    phone: sanitizePhones(candidate.phone)
  };
}

async function saveSource(candidateId: string, sourceType: string, candidate: CandidateImport) {
  const existing = await q<{ id: string }>(
    "SELECT id FROM candidate_sources WHERE candidate_id=$1 AND source_type=$2 AND coalesce(source_id,'')=coalesce($3,'') LIMIT 1",
    [candidateId, sourceType, candidate.sourceId]
  );

  if (existing.rows[0]) {
    await q(
      "UPDATE candidate_sources SET source_url=coalesce($1,source_url), source_data=$2::jsonb, last_synced_at=now(), is_active=true WHERE id=$3",
      [candidate.sourceUrl, JSON.stringify(candidate.raw), existing.rows[0].id]
    );
  } else {
    await q(
      "INSERT INTO candidate_sources (candidate_id, source_type, source_id, source_url, source_data) VALUES ($1,$2,$3,$4,$5::jsonb)",
      [candidateId, sourceType, candidate.sourceId, candidate.sourceUrl, JSON.stringify(candidate.raw)]
    );
  }

  await q(
    "UPDATE candidates SET source_count=(SELECT count(*)::int FROM candidate_sources WHERE candidate_id=$1) WHERE id=$1",
    [candidateId]
  );
}

export async function recordRejectedImport(sourceType: string, candidate: CandidateImport | null, reason: string, payload?: Record<string, unknown>) {
  await q(
    `INSERT INTO rejected_imports (source_type, source_id, source_url, extracted_name, reason, payload)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      sourceType,
      candidate?.sourceId ?? null,
      candidate?.sourceUrl ?? null,
      candidate?.fullName ?? null,
      reason,
      JSON.stringify(payload ?? candidate?.raw ?? {})
    ]
  );
}

async function saveDocuments(candidateId: string, sourceType: string, candidate: CandidateImport) {
  for (const document of candidate.documents ?? []) {
    if (!document.fileUrl && !document.sourcePath && !document.sourceId && !document.rawText) continue;
    const fileName = document.fileName || `${candidate.fullName} - ${document.type}`;
    const existing = await q<{ id: string }>(
      `SELECT id FROM documents
       WHERE candidate_id=$1
         AND type=$2
         AND coalesce(file_url,'')=coalesce($3,'')
         AND coalesce(source_id,'')=coalesce($4,'')
       LIMIT 1`,
      [candidateId, document.type, document.fileUrl, document.sourceId]
    );

    if (existing.rows[0]) {
      await q(
        `UPDATE documents SET
          file_name=$1,
          file_url=coalesce($2,file_url),
          raw_text=coalesce($3,raw_text),
          mime_type=coalesce($4,mime_type),
          source_path=coalesce($5,source_path),
          is_primary_cv=$6
         WHERE id=$7`,
        [fileName, document.fileUrl, document.rawText, document.mimeType, document.sourcePath, Boolean(document.isPrimaryCv), existing.rows[0].id]
      );
    } else {
      await q(
        `INSERT INTO documents (candidate_id, type, file_name, file_url, raw_text, mime_type, source_type, source_id, source_path, is_primary_cv)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [candidateId, document.type, fileName, document.fileUrl ?? document.sourcePath, document.rawText, document.mimeType, sourceType, document.sourceId, document.sourcePath, Boolean(document.isPrimaryCv)]
      );
    }
  }
}

export async function importCandidate(sourceType: string, candidate: CandidateImport, isUsableCandidate: CandidateValidator): Promise<CandidateImportResult> {
  candidate = sanitizeCandidate(candidate);
  if (!isUsableCandidate(candidate, sourceType)) {
    await recordRejectedImport(sourceType, candidate, "No parece una persona real o parece una oferta, barrio o categoria.");
    return "skipped";
  }
  let existingId: string | null = null;

  if (candidate.sourceId) {
    const bySource = await q<{ candidate_id: string }>(
      "SELECT candidate_id FROM candidate_sources WHERE source_type=$1 AND source_id=$2 LIMIT 1",
      [sourceType, candidate.sourceId]
    );
    existingId = bySource.rows[0]?.candidate_id ?? null;
  }

  if (!existingId && candidate.email.length > 0) {
    const byEmail = await q<{ id: string }>("SELECT id FROM candidates WHERE email && $1::text[] LIMIT 1", [candidate.email]);
    existingId = byEmail.rows[0]?.id ?? null;
  }

  if (!existingId && candidate.phone.length > 0) {
    const byPhone = await q<{ id: string }>("SELECT id FROM candidates WHERE phone && $1::text[] LIMIT 1", [candidate.phone]);
    existingId = byPhone.rows[0]?.id ?? null;
  }

  if (existingId) {
    const stillExists = await q<{ id: string }>("SELECT id FROM candidates WHERE id=$1 LIMIT 1", [existingId]);
    if (!stillExists.rows[0]) {
      existingId = null;
    }
  }

  if (existingId) {
    const updated = await q<{ id: string }>(
      `UPDATE candidates SET
        full_name=coalesce($1, full_name),
        first_name=coalesce($2, first_name),
        last_name=coalesce($3, last_name),
        email=coalesce((SELECT array_agg(DISTINCT value) FROM unnest(email || $4::text[]) AS value), '{}'::text[]),
        phone=coalesce((SELECT array_agg(DISTINCT value) FROM unnest(phone || $5::text[]) AS value), '{}'::text[]),
        city=coalesce($6, city),
        country=coalesce($7, country),
        linkedin_url=coalesce($8, linkedin_url),
        "current_role"=coalesce($9, "current_role"),
        ai_seniority=coalesce($10, ai_seniority),
        ai_seniority_years=coalesce($11, ai_seniority_years),
        ai_tags=coalesce((SELECT array_agg(DISTINCT value) FROM unnest(ai_tags || $12::text[]) AS value), '{}'::text[]),
        ai_summary=coalesce($13, ai_summary),
        updated_at=now(),
        last_seen_at=now()
       WHERE id=$14
       RETURNING id`,
      [candidate.fullName, candidate.firstName, candidate.lastName, candidate.email, candidate.phone, candidate.city,
        candidate.country, candidate.linkedinUrl, candidate.currentRole, candidate.seniority, candidate.years,
        candidate.tags, candidate.summary, existingId]
    );
    const updatedId = updated.rows[0]?.id;
    if (updatedId) {
      await saveSource(updatedId, sourceType, candidate);
      await saveDocuments(updatedId, sourceType, candidate);
      return "updated";
    }
  }

  const inserted = await q<{ id: string }>(
    `INSERT INTO candidates (full_name, first_name, last_name, email, phone, city, country, linkedin_url, "current_role",
      ai_seniority, ai_seniority_years, ai_tags, ai_summary, quality_score, status, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active',now())
     RETURNING id`,
    [candidate.fullName, candidate.firstName, candidate.lastName, candidate.email, candidate.phone, candidate.city,
      candidate.country, candidate.linkedinUrl, candidate.currentRole, candidate.seniority, candidate.years,
      candidate.tags, candidate.summary, candidate.qualityScore]
  );
  await saveSource(inserted.rows[0].id, sourceType, candidate);
  await saveDocuments(inserted.rows[0].id, sourceType, candidate);
  return "new";
}
