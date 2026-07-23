import type { CandidateImport } from "../agents/types.js";
import { createHash } from "crypto";
import { q } from "../db/pool.js";
import { namesLikelySame, normalizePhoneIdentity } from "./candidateIdentity.js";

export type CandidateImportResult = "new" | "updated" | "unchanged" | "skipped";

export type CandidateValidator = (candidate: CandidateImport, sourceType: string) => boolean;

function unique(values: string[]) {
  return [...new Set(values)];
}

function cleanDbText(value: string | null | undefined) {
  const text = value == null ? null : String(value).replace(/\u0000/g, "").trim();
  return text || null;
}

function cleanDbTextArray(values: string[] | undefined) {
  return unique((values ?? [])
    .map((value) => cleanDbText(value))
    .filter((value): value is string => Boolean(value)));
}

function cleanHumanField(value: string | null | undefined) {
  const cleaned = cleanDbText(value);
  if (!cleaned || !/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(cleaned)) return null;
  if (/^[\d\s,.;:/_-]+$/.test(cleaned)) return null;
  return cleaned;
}

const SOURCE_DATE_KEYS = new Set([
  "sourcecreatedat", "submittedat", "applicationdate", "applicationcreatedat", "receivedat",
  "receiveddate", "internaldate", "createdat", "created", "date", "fechapostulacion",
  "fecharecepcion", "fechacreacion", "fecha"
]);

function sourceDateFrom(value: unknown, depth = 0): string | null {
  if (!value || depth > 4) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = sourceDateFrom(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!SOURCE_DATE_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) continue;
    const raw = String(item ?? "").trim();
    const numeric = /^\d{12,13}$/.test(raw) ? Number(raw) : NaN;
    const parsed = Number.isFinite(numeric) ? new Date(numeric) : new Date(raw);
    if (Number.isFinite(parsed.getTime()) && parsed.getTime() <= Date.now() + 86_400_000) return parsed.toISOString();
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    const found = sourceDateFrom(item, depth + 1);
    if (found) return found;
  }
  return null;
}

function candidateSourceDate(candidate: CandidateImport) {
  return sourceDateFrom({ sourceCreatedAt: candidate.sourceCreatedAt, raw: candidate.raw });
}

const ROLE_TAGS = new Set([
  "abogado",
  "administracion",
  "atencion al cliente",
  "comercial",
  "gastronomia",
  "logistica",
  "marketing",
  "recursos humanos",
  "tecnico",
  "ventas"
]);

function cleanCurrentRole(value: string | null | undefined, tags: string[]) {
  const role = cleanHumanField(value);
  if (role && !/^(?:postgres|postgresql|database|supabase|render|gmail|google|drive|cv|curriculum|curriculo|currículo|currículum|vitae|pdf|doc|docx|rtf|txt|postulaci[oó]n laboral|trabajo|empleo)$/i.test(role)) {
    return role;
  }
  return tags.find((tag) => ROLE_TAGS.has(tag.toLowerCase())) ?? null;
}

function scrubJsonForDb(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\u0000/g, "");
  if (Array.isArray(value)) return value.map(scrubJsonForDb);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, scrubJsonForDb(item)]));
  }
  return value;
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
      if (digits.length > 9 && !digits.startsWith("598")) return false;
      if (/^0+$/.test(digits)) return false;
      if (/^(\d)\1{6,}$/.test(digits)) return false;
      if (/^(?:19|20)\d{6}(?:\d{4,6})?$/.test(digits)) return false;
      if (/^(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{6}$/.test(digits)) return false;
      if (/^(?:\d{1,2}) ?(?:\d{1,2}) ?0{5,}$/.test(value)) return false;
      return true;
    }));
}

function sanitizeCandidate(candidate: CandidateImport): CandidateImport {
  const tags = cleanDbTextArray(candidate.tags);
  return {
    ...candidate,
    fullName: cleanDbText(candidate.fullName) ?? candidate.fullName,
    firstName: cleanDbText(candidate.firstName),
    lastName: cleanDbText(candidate.lastName),
    email: sanitizeEmails(candidate.email),
    phone: sanitizePhones(candidate.phone),
    city: cleanHumanField(candidate.city),
    country: cleanHumanField(candidate.country),
    linkedinUrl: cleanDbText(candidate.linkedinUrl),
    currentRole: cleanCurrentRole(candidate.currentRole, tags),
    seniority: cleanDbText(candidate.seniority),
    tags,
    languages: (candidate.languages ?? []).map((language) => ({
      lang: cleanDbText(language.lang) ?? language.lang,
      level: cleanDbText(language.level),
      evidence: cleanDbText(language.evidence) ?? undefined
    })),
    summary: cleanDbText(candidate.summary),
    sourceId: cleanDbText(candidate.sourceId),
    sourceUrl: cleanDbText(candidate.sourceUrl),
    sourceCreatedAt: cleanDbText(candidate.sourceCreatedAt),
    raw: scrubJsonForDb(candidate.raw ?? {}) as Record<string, unknown>,
    documents: candidate.documents?.map((document) => ({
      ...document,
      type: cleanDbText(document.type) ?? document.type,
      fileName: cleanDbText(document.fileName) ?? document.fileName,
      fileUrl: cleanDbText(document.fileUrl),
      rawText: cleanDbText(document.rawText),
      mimeType: cleanDbText(document.mimeType),
      sourceId: cleanDbText(document.sourceId),
      sourcePath: cleanDbText(document.sourcePath)
    }))
  };
}

function documentFileBuffer(value: string | null | undefined) {
  if (!value) return null;
  try {
    return Buffer.from(value, "base64");
  } catch {
    return null;
  }
}

export function documentContentHash(fileData: Buffer | null, rawText: string | null | undefined) {
  if (fileData?.length) return createHash("sha256").update(fileData).digest("hex");
  const text = cleanDbText(rawText);
  return text ? `text-sha256:${createHash("sha256").update(text).digest("hex")}` : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

export function candidateContentHash(candidate: CandidateImport) {
  const documents = (candidate.documents ?? []).map((document) => {
    const fileData = documentFileBuffer(document.fileDataBase64);
    return {
      type: document.type,
      fileName: document.fileName,
      fileUrl: document.fileUrl ?? null,
      mimeType: document.mimeType ?? null,
      sourceId: document.sourceId ?? null,
      sourcePath: document.sourcePath ?? null,
      isPrimaryCv: Boolean(document.isPrimaryCv),
      sizeBytes: document.sizeBytes ?? fileData?.byteLength ?? null,
      fileHash: cleanDbText(document.fileHash) ?? documentContentHash(fileData, document.rawText)
    };
  }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const payload = stableValue({
    fullName: candidate.fullName,
    firstName: candidate.firstName ?? null,
    lastName: candidate.lastName ?? null,
    email: [...candidate.email].sort(),
    phone: [...candidate.phone].sort(),
    city: candidate.city ?? null,
    country: candidate.country ?? null,
    linkedinUrl: candidate.linkedinUrl ?? null,
    currentRole: candidate.currentRole ?? null,
    seniority: candidate.seniority ?? null,
    years: candidate.years ?? null,
    tags: [...candidate.tags].sort(),
    languages: candidate.languages ?? [],
    summary: candidate.summary ?? null,
    sourceUrl: candidate.sourceUrl ?? null,
    sourceCreatedAt: candidate.sourceCreatedAt ?? null,
    documents
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function saveSource(candidateId: string, sourceType: string, candidate: CandidateImport, contentHash: string) {
  const sourceCreatedAt = candidateSourceDate(candidate);
  const existing = await q<{ id: string }>(
    "SELECT id FROM candidate_sources WHERE candidate_id=$1 AND source_type=$2 AND coalesce(source_id,'')=coalesce($3,'') LIMIT 1",
    [candidateId, sourceType, candidate.sourceId]
  );

  if (existing.rows[0]) {
    await q(
      "UPDATE candidate_sources SET source_url=coalesce($1,source_url), source_data=$2::jsonb, source_created_at=coalesce($3::timestamptz,source_created_at), content_hash=$4, last_synced_at=now(), is_active=true WHERE id=$5",
      [candidate.sourceUrl, JSON.stringify(candidate.raw), sourceCreatedAt, contentHash, existing.rows[0].id]
    );
  } else {
    await q(
      "INSERT INTO candidate_sources (candidate_id, source_type, source_id, source_url, source_data, source_created_at, content_hash) VALUES ($1,$2,$3,$4,$5::jsonb,$6::timestamptz,$7)",
      [candidateId, sourceType, candidate.sourceId, candidate.sourceUrl, JSON.stringify(candidate.raw), sourceCreatedAt, contentHash]
    );
  }

  await q(
    "UPDATE candidates SET source_count=(SELECT count(DISTINCT source_type)::int FROM candidate_sources WHERE candidate_id=$1) WHERE id=$1",
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
    const fileData = documentFileBuffer(document.fileDataBase64);
    if (!document.fileUrl && !document.sourcePath && !document.sourceId && !document.rawText && !fileData) continue;
    const fileName = document.fileName || `${candidate.fullName} - ${document.type}`;
    const fileHash = cleanDbText(document.fileHash) ?? documentContentHash(fileData, document.rawText);
    const existing = await q<{ id: string }>(
      `SELECT id FROM documents
       WHERE candidate_id=$1
         AND (
           ($2::text IS NOT NULL AND file_hash=$2)
           OR ($3::text IS NOT NULL AND source_type=$4 AND source_id=$3)
           OR ($7::text IS NOT NULL AND raw_text=$7)
           OR (
             $2::text IS NULL AND $3::text IS NULL AND $7::text IS NULL
             AND type=$5
             AND coalesce(file_url,'')=coalesce($6,'')
           )
         )
       LIMIT 1`,
      [candidateId, fileHash, document.sourceId, sourceType, document.type, document.fileUrl, document.rawText]
    );

    if (existing.rows[0]) {
      await q(
        `UPDATE documents SET
          file_name=$1,
          file_url=coalesce($2,file_url),
          raw_text=coalesce($3,raw_text),
          mime_type=coalesce($4,mime_type),
          source_path=coalesce($5,source_path),
          is_primary_cv=is_primary_cv OR $6,
          file_data=coalesce($7,file_data),
          size_bytes=coalesce($8,size_bytes),
          file_hash=coalesce($9,file_hash),
          file_data_saved_at=case when $7::bytea is not null then now() else file_data_saved_at end
         WHERE id=$10`,
        [fileName, document.fileUrl, document.rawText, document.mimeType, document.sourcePath, Boolean(document.isPrimaryCv), fileData, document.sizeBytes ?? fileData?.byteLength ?? null, fileHash, existing.rows[0].id]
      );
    } else {
      await q(
        `INSERT INTO documents (candidate_id, type, file_name, file_url, raw_text, mime_type, source_type, source_id, source_path, is_primary_cv, file_data, size_bytes, file_hash, file_data_saved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,case when $11::bytea is not null then now() else null end)`,
        [candidateId, document.type, fileName, document.fileUrl ?? document.sourcePath, document.rawText, document.mimeType, sourceType, document.sourceId, document.sourcePath, Boolean(document.isPrimaryCv), fileData, document.sizeBytes ?? fileData?.byteLength ?? null, fileHash]
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
  const contentHash = candidateContentHash(candidate);

  if (candidate.sourceId) {
    const bySource = await q<{ candidate_id: string; content_hash: string | null }>(
      "SELECT candidate_id, content_hash FROM candidate_sources WHERE source_type=$1 AND source_id=$2 LIMIT 1",
      [sourceType, candidate.sourceId]
    );
    existingId = bySource.rows[0]?.candidate_id ?? null;
    if (existingId && bySource.rows[0]?.content_hash === contentHash) {
      await q(
        `UPDATE candidate_sources
         SET last_synced_at=now(), is_active=true,
           source_created_at=coalesce(source_created_at,$1::timestamptz)
         WHERE candidate_id=$2 AND source_type=$3 AND source_id=$4`,
        [candidateSourceDate(candidate), existingId, sourceType, candidate.sourceId]
      );
      await q("UPDATE candidates SET last_seen_at=now() WHERE id=$1", [existingId]);
      return "unchanged";
    }
  }

  if (!existingId && candidate.email.length > 0) {
    const byEmail = await q<{ id: string; full_name: string }>(
      "SELECT id, full_name FROM candidates WHERE duplicate_of IS NULL AND email && $1::text[] ORDER BY updated_at DESC LIMIT 20",
      [candidate.email]
    );
    existingId = byEmail.rows.find((row) => namesLikelySame(row.full_name, candidate.fullName))?.id ?? null;
  }

  if (!existingId && candidate.phone.length > 0) {
    const normalizedPhones = candidate.phone.map(normalizePhoneIdentity).filter(Boolean);
    const byPhone = await q<{ id: string; full_name: string }>(
      `SELECT DISTINCT c.id, c.full_name
       FROM candidates c
       CROSS JOIN LATERAL unnest(c.phone) AS stored_phone(value)
       WHERE c.duplicate_of IS NULL
         AND (
           CASE
             WHEN regexp_replace(stored_phone.value, '\\D', '', 'g') ~ '^598[0-9]{8}$'
             THEN '0' || substring(regexp_replace(stored_phone.value, '\\D', '', 'g') from 4)
             ELSE regexp_replace(stored_phone.value, '\\D', '', 'g')
           END
         ) = ANY($1::text[])
       ORDER BY c.id
       LIMIT 20`,
      [normalizedPhones]
    );
    existingId = byPhone.rows.find((row) => namesLikelySame(row.full_name, candidate.fullName))?.id ?? null;
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
        city=coalesce($6, case when city ~ '[[:alpha:]ÁÉÍÓÚÜÑáéíóúüñ]' then city else null end),
        country=coalesce($7, case when country ~ '[[:alpha:]ÁÉÍÓÚÜÑáéíóúüñ]' then country else null end),
        linkedin_url=coalesce($8, linkedin_url),
        "current_role"=coalesce($9, case when "current_role" !~ '[[:alpha:]ÁÉÍÓÚÜÑáéíóúüñ]' or "current_role" ~* '^(postgres|postgresql|database|supabase|render|gmail|google|drive|cv|curriculum|curriculo|currículo|currículum|vitae|pdf|doc|docx|rtf|txt|postulación laboral|postulacion laboral|trabajo|empleo)$' then null else "current_role" end),
        ai_seniority=coalesce($10, ai_seniority),
        ai_seniority_years=coalesce($11, ai_seniority_years),
        ai_tags=coalesce((SELECT array_agg(DISTINCT value) FROM unnest(ai_tags || $12::text[]) AS value), '{}'::text[]),
        ai_languages=case when jsonb_array_length($13::jsonb) > 0 then $13::jsonb else ai_languages end,
        ai_summary=coalesce($14, ai_summary),
        updated_at=now(),
        last_seen_at=now()
       WHERE id=$15
       RETURNING id`,
      [candidate.fullName, candidate.firstName, candidate.lastName, candidate.email, candidate.phone, candidate.city,
        candidate.country, candidate.linkedinUrl, candidate.currentRole, candidate.seniority, candidate.years,
        candidate.tags, JSON.stringify(candidate.languages ?? []), candidate.summary, existingId]
    );
    const updatedId = updated.rows[0]?.id;
    if (updatedId) {
      await saveSource(updatedId, sourceType, candidate, contentHash);
      await saveDocuments(updatedId, sourceType, candidate);
      return "updated";
    }
  }

  const inserted = await q<{ id: string }>(
    `INSERT INTO candidates (full_name, first_name, last_name, email, phone, city, country, linkedin_url, "current_role",
      ai_seniority, ai_seniority_years, ai_tags, ai_languages, ai_summary, quality_score, status, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,'active',now())
     RETURNING id`,
    [candidate.fullName, candidate.firstName, candidate.lastName, candidate.email, candidate.phone, candidate.city,
      candidate.country, candidate.linkedinUrl, candidate.currentRole, candidate.seniority, candidate.years,
      candidate.tags, JSON.stringify(candidate.languages ?? []), candidate.summary, candidate.qualityScore]
  );
  await saveSource(inserted.rows[0].id, sourceType, candidate, contentHash);
  await saveDocuments(inserted.rows[0].id, sourceType, candidate);
  return "new";
}
