import { Router } from "express";
import { z } from "zod";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { requireRole } from "../middleware/auth.js";

export const candidatesRouter = Router();

const candidateSchema = z.object({
  fullName: z.string().min(2),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  email: z.array(z.string().email()).default([]),
  phone: z.array(z.string()).default([]),
  city: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  linkedinUrl: z.string().optional().nullable(),
  currentRole: z.string().optional().nullable(),
  seniority: z.string().optional().nullable(),
  years: z.number().int().min(0).max(80).optional().nullable(),
  tags: z.array(z.string()).default([]),
  languages: z.array(z.any()).default([]),
  summary: z.string().optional().nullable(),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  qualityScore: z.number().int().min(0).max(100).default(0),
  status: z.string().default("active")
});

function mapCandidate(row: any) {
  return {
    id: row.id,
    fullName: row.full_name,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email ?? [],
    phone: row.phone ?? [],
    city: row.city,
    country: row.country,
    linkedinUrl: row.linkedin_url,
    currentRole: row.current_role,
    seniority: row.ai_seniority,
    years: row.ai_seniority_years,
    tags: row.ai_tags ?? [],
    languages: row.ai_languages ?? [],
    summary: row.ai_summary,
    strengths: row.ai_strengths ?? [],
    weaknesses: row.ai_weaknesses ?? [],
    qualityScore: row.quality_score,
    sourceCount: row.source_count,
    documentCount: Number(row.document_count ?? 0),
    primaryDocumentName: row.primary_document_name ?? null,
    status: row.status,
    createdAt: row.created_at
  };
}

function expandedSearchTerms(query: string) {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3);
  const extras: Record<string, string[]> = {
    vendedor: ["ventas", "comercial", "ejecutivo comercial"],
    vendedora: ["ventas", "comercial", "ejecutiva comercial"],
    ventas: ["vendedor", "vendedora", "comercial"],
    comercial: ["ventas", "vendedor", "vendedora"],
    ingeniero: ["ingenieria", "ingeniería", "engineer"],
    ingeniera: ["ingenieria", "ingeniería", "engineer"],
    desarrollador: ["developer", "programador", "software"],
    desarrolladora: ["developer", "programadora", "software"],
    rrhh: ["recursos humanos", "talento", "seleccion", "selección"],
    seleccion: ["selección", "reclutamiento", "recursos humanos"],
    selección: ["seleccion", "reclutamiento", "recursos humanos"]
  };
  return [...new Set([query, ...words, ...words.flatMap((word) => extras[word] ?? [])])]
    .map((term) => `%${term}%`);
}

const excludeFalseGmailCandidatesSql = `NOT (
  (
    EXISTS (
      SELECT 1
      FROM candidate_sources false_gmail_source
      WHERE false_gmail_source.candidate_id = candidates.id
        AND false_gmail_source.source_type = 'gmail'
    )
    OR 'gmail' = ANY(coalesce(candidates.ai_tags, '{}'::text[]))
  )
  AND (
    lower(trim(coalesce(candidates.full_name, ''))) = ANY(ARRAY[
      'the google cloud team',
      'google cloud team',
      'google workspace team',
      'google team',
      'microsoft account team',
      'linkedin notifications'
    ])
    OR lower(coalesce(candidates.current_role, '')) LIKE '%work account access%'
    OR (
      cardinality(coalesce(candidates.email, '{}'::text[])) = 0
      AND cardinality(coalesce(candidates.phone, '{}'::text[])) = 0
      AND coalesce(candidates.linkedin_url, '') = ''
      AND (
        lower(coalesce(candidates.ai_summary, '')) LIKE '%your request for work account access%'
        OR lower(coalesce(candidates.ai_summary, '')) LIKE '%google cloud%'
        OR lower(coalesce(candidates.ai_summary, '')) LIKE '%google workspace%'
        OR lower(coalesce(candidates.ai_summary, '')) LIKE '%security alert%'
        OR lower(coalesce(candidates.ai_summary, '')) LIKE '%billing%'
        OR lower(coalesce(candidates.ai_summary, '')) LIKE '%%pdf-1.%'
        OR lower(coalesce(candidates.ai_summary, '')) LIKE '%google docs renderer%'
        OR lower(coalesce(candidates.ai_summary, '')) LIKE '%comparto%contigo%'
        OR lower(coalesce(candidates.ai_summary, '')) LIKE '%shared%with you%'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM documents false_gmail_doc
      WHERE false_gmail_doc.candidate_id = candidates.id
        AND false_gmail_doc.source_type = 'gmail'
        AND (
          lower(coalesce(false_gmail_doc.raw_text, '')) LIKE '%request for work account access%'
          OR lower(coalesce(false_gmail_doc.raw_text, '')) LIKE '%google cloud%'
          OR lower(coalesce(false_gmail_doc.raw_text, '')) LIKE '%%pdf-1.%'
          OR lower(coalesce(false_gmail_doc.raw_text, '')) LIKE '%google docs renderer%'
          OR lower(coalesce(false_gmail_doc.raw_text, '')) LIKE '%comparto%contigo%'
          OR lower(coalesce(false_gmail_doc.raw_text, '')) LIKE '%shared%with you%'
          OR lower(coalesce(false_gmail_doc.file_name, '')) LIKE '%request for work account access%'
        )
    )
  )
)`;

async function cleanupFalseGmailCandidates() {
  await q(
    `DELETE FROM candidates c
     WHERE c.duplicate_of IS NULL
       AND (
         EXISTS (
           SELECT 1
           FROM candidate_sources cs
           WHERE cs.candidate_id = c.id
             AND cs.source_type = 'gmail'
         )
         OR 'gmail' = ANY(coalesce(c.ai_tags, '{}'::text[]))
       )
       AND (
         lower(trim(coalesce(c.full_name, ''))) = ANY(ARRAY[
           'the google cloud team',
           'google cloud team',
           'google workspace team',
           'google team',
           'microsoft account team',
           'linkedin notifications'
         ])
         OR lower(coalesce(c.current_role, '')) LIKE '%work account access%'
         OR (
           cardinality(coalesce(c.email, '{}'::text[])) = 0
           AND cardinality(coalesce(c.phone, '{}'::text[])) = 0
           AND coalesce(c.linkedin_url, '') = ''
           AND (
             lower(coalesce(c.ai_summary, '')) LIKE '%your request for work account access%'
             OR lower(coalesce(c.ai_summary, '')) LIKE '%google cloud%'
             OR lower(coalesce(c.ai_summary, '')) LIKE '%google workspace%'
             OR lower(coalesce(c.ai_summary, '')) LIKE '%security alert%'
             OR lower(coalesce(c.ai_summary, '')) LIKE '%billing%'
             OR lower(coalesce(c.ai_summary, '')) LIKE '%verification code%'
             OR lower(coalesce(c.ai_summary, '')) LIKE '%%pdf-1.%'
             OR lower(coalesce(c.ai_summary, '')) LIKE '%google docs renderer%'
             OR lower(coalesce(c.ai_summary, '')) LIKE '%comparto%contigo%'
             OR lower(coalesce(c.ai_summary, '')) LIKE '%shared%with you%'
           )
         )
         OR EXISTS (
           SELECT 1
           FROM documents d
           WHERE d.candidate_id = c.id
             AND d.source_type = 'gmail'
             AND (
               lower(coalesce(d.raw_text, '')) LIKE '%request for work account access%'
               OR lower(coalesce(d.raw_text, '')) LIKE '%google cloud%'
               OR lower(coalesce(d.raw_text, '')) LIKE '%%pdf-1.%'
               OR lower(coalesce(d.raw_text, '')) LIKE '%google docs renderer%'
               OR lower(coalesce(d.raw_text, '')) LIKE '%comparto%contigo%'
               OR lower(coalesce(d.raw_text, '')) LIKE '%shared%with you%'
               OR lower(coalesce(d.file_name, '')) LIKE '%request for work account access%'
             )
         )
       )`
  );
}

const importSchema = z.object({
  sourceType: z.string().trim().min(1).default("manual"),
  data: z.string().min(1)
});

type ImportedCandidate = {
  fullName: string;
  email: string[];
  phone: string[];
  city?: string | null;
  country?: string | null;
  linkedinUrl?: string | null;
  currentRole?: string | null;
  tags: string[];
  summary?: string | null;
  sourceId?: string | null;
  sourceUrl?: string | null;
  rawText?: string | null;
  raw: Record<string, unknown>;
};

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values: unknown[]) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function decodeBase64UrlBuffer(value: string) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

async function googleAccessTokenFromConfig(config: Record<string, unknown>) {
  const refreshToken = cleanText(config.refreshToken);
  const clientId = cleanText(config.clientId);
  const clientSecret = cleanText(config.clientSecret);
  const direct = cleanText(config.accessToken ?? config.token ?? config.apiKey).replace(/^Bearer\s+/i, "");
  if (!refreshToken || !clientId || !clientSecret) return direct || null;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) return null;
  return String(payload.access_token);
}

function listFrom(value: unknown) {
  if (Array.isArray(value)) return unique(value);
  return unique(String(value ?? "").split(/[,;|\n]+/));
}

function extractEmails(text: string) {
  return unique(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((email) => email.toLowerCase());
}

function extractPhones(text: string) {
  return unique(text.match(/(?:\+?\d[\d\s().-]{6,}\d)/g) ?? []).map((phone) => phone.replace(/\s+/g, " ").trim());
}

function firstValue(row: Record<string, unknown>, names: string[]) {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, ""), value]));
  for (const name of names) {
    const value = normalized.get(name.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, ""));
    if (cleanText(value)) return cleanText(value);
  }
  return "";
}

function parseDelimited(data: string) {
  const lines = data.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headerLine = lines[0];
  const separators = [";", "\t", ","];
  const separator = separators
    .map((sep) => ({ sep, count: headerLine.split(sep).length }))
    .sort((a, b) => b.count - a.count)[0].sep;
  const parseLine = (line: string) => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];
      if (char === '"' && quoted && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === separator && !quoted) {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += char;
      }
    }
    cells.push(cell.trim());
    return cells;
  };
  const headers = parseLine(headerLine).map(cleanText);
  if (headers.length < 2) return [];
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header || `columna_${index + 1}`, cells[index] ?? ""]));
  });
}

function rowsFromImportData(data: string) {
  const trimmed = data.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
    if (parsed && typeof parsed === "object") return [parsed as Record<string, unknown>];
  } catch {
    // Not JSON; continue with CSV/TSV/free text parsing.
  }
  const delimited = parseDelimited(trimmed);
  if (delimited.length) return delimited;
  return trimmed
    .split(/\n\s*\n|(?=\n[A-ZÁÉÍÓÚÑ][^\n]{2,80}\s*(?:\n|$))/u)
    .map((chunk, index) => ({ Texto: chunk.trim(), sourceId: `text-${index + 1}` }))
    .filter((row) => cleanText(row.Texto));
}

function isLikelyPersonName(name: string) {
  const cleaned = cleanText(name);
  if (cleaned.length < 4 || cleaned.length > 90) return false;
  if (/@|https?:|www\.|\.com|\d{3,}|buscojobs|gmail|drive|linkedin/i.test(cleaned)) return false;
  if (/(seleccion|busqueda|oferta|vacante|cargo|empresa|zona|barrio|departamento|postulacion|actualizacion|proceso)/i.test(cleaned)) return false;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.length >= 2 || /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/u.test(cleaned);
}

function candidateFromRow(row: Record<string, unknown>, sourceType: string): ImportedCandidate | null {
  const allText = Object.values(row).map(cleanText).filter(Boolean).join("\n");
  const textField = firstValue(row, ["texto", "text", "rawText", "raw_text", "cv", "curriculum", "contenido", "body", "mensaje"]) || allText;
  const email = unique([
    ...listFrom(firstValue(row, ["email", "mail", "correo", "correo electronico", "e-mail"])),
    ...extractEmails(allText)
  ]).map((mail) => mail.toLowerCase());
  const phone = unique([
    ...listFrom(firstValue(row, ["telefono", "teléfono", "celular", "phone", "mobile", "whatsapp"])),
    ...extractPhones(allText)
  ]);
  let fullName = firstValue(row, ["fullName", "full_name", "nombre completo", "nombre", "name", "postulante", "candidato", "persona"]);
  if (!isLikelyPersonName(fullName)) {
    const lines = textField.split(/\r?\n/).map(cleanText).filter(Boolean);
    fullName = lines.find(isLikelyPersonName) ?? "";
  }
  if (!isLikelyPersonName(fullName) && !email.length) return null;
  if (!isLikelyPersonName(fullName)) fullName = email[0].split("@")[0].replace(/[._-]+/g, " ");
  const currentRole = firstValue(row, ["cargo", "puesto", "rol", "role", "position", "postulacion", "postulación", "vacante", "oferta", "currentRole", "current_role"]);
  const city = firstValue(row, ["ciudad", "city", "ubicacion", "ubicación", "location", "localidad"]);
  const country = firstValue(row, ["pais", "país", "country"]);
  const linkedinUrl = firstValue(row, ["linkedin", "linkedinUrl", "linkedin_url", "profileUrl", "profile_url", "url"]);
  const summary = firstValue(row, ["resumen", "summary", "notas", "notes", "experiencia", "perfil"]) || (textField.length > 30 ? textField.slice(0, 2000) : "");
  const tags = unique([
    ...listFrom(firstValue(row, ["tags", "skills", "habilidades", "competencias", "area", "área"])),
    ...(currentRole ? [currentRole] : [])
  ]).slice(0, 20);
  return {
    fullName: cleanText(fullName),
    email,
    phone,
    city: city || null,
    country: country || null,
    linkedinUrl: linkedinUrl || null,
    currentRole: currentRole || null,
    tags,
    summary: summary || null,
    sourceId: firstValue(row, ["id", "sourceId", "source_id", "candidateId", "candidate_id", "postulanteId", "postulacionId"]) || email[0] || `${sourceType}-${fullName}`,
    sourceUrl: linkedinUrl || firstValue(row, ["url", "sourceUrl", "source_url"]) || null,
    rawText: textField || null,
    raw: row
  };
}

async function upsertImportedCandidate(sourceType: string, candidate: ImportedCandidate) {
  const existing = candidate.email.length
    ? await q("SELECT * FROM candidates WHERE duplicate_of IS NULL AND email && $1::text[] ORDER BY updated_at DESC LIMIT 1", [candidate.email])
    : candidate.phone.length
      ? await q("SELECT * FROM candidates WHERE duplicate_of IS NULL AND phone && $1::text[] ORDER BY updated_at DESC LIMIT 1", [candidate.phone])
      : { rows: [] };
  let row;
  let created = false;
  if (existing.rows[0]) {
    const current = existing.rows[0];
    const { rows } = await q(
      `UPDATE candidates SET
        full_name=coalesce(nullif($2,''), full_name),
        email=(SELECT coalesce(array_agg(DISTINCT value), '{}') FROM unnest(coalesce(email,'{}') || $3::text[]) value),
        phone=(SELECT coalesce(array_agg(DISTINCT value), '{}') FROM unnest(coalesce(phone,'{}') || $4::text[]) value),
        city=coalesce($5, city),
        country=coalesce($6, country),
        linkedin_url=coalesce($7, linkedin_url),
        "current_role"=coalesce($8, "current_role"),
        ai_tags=(SELECT coalesce(array_agg(DISTINCT value), '{}') FROM unnest(coalesce(ai_tags,'{}') || $9::text[]) value),
        ai_summary=coalesce($10, ai_summary),
        last_seen_at=now(),
        updated_at=now()
       WHERE id=$1 RETURNING *`,
      [current.id, candidate.fullName, candidate.email, candidate.phone, candidate.city, candidate.country, candidate.linkedinUrl, candidate.currentRole, candidate.tags, candidate.summary]
    );
    row = rows[0];
  } else {
    const { rows } = await q(
      `INSERT INTO candidates (full_name, email, phone, city, country, linkedin_url, "current_role", ai_tags, ai_summary, quality_score, status, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,50,'active',now())
       RETURNING *`,
      [candidate.fullName, candidate.email, candidate.phone, candidate.city, candidate.country, candidate.linkedinUrl, candidate.currentRole, candidate.tags, candidate.summary]
    );
    row = rows[0];
    created = true;
  }

  const source = await q<{ id: string }>(
    "SELECT id FROM candidate_sources WHERE candidate_id=$1 AND source_type=$2 AND coalesce(source_id,'')=coalesce($3,'') LIMIT 1",
    [row.id, sourceType, candidate.sourceId]
  );
  if (source.rows[0]) {
    await q("UPDATE candidate_sources SET source_url=coalesce($1,source_url), source_data=$2::jsonb, last_synced_at=now(), is_active=true WHERE id=$3", [candidate.sourceUrl, JSON.stringify(candidate.raw), source.rows[0].id]);
  } else {
    await q("INSERT INTO candidate_sources (candidate_id, source_type, source_id, source_url, source_data) VALUES ($1,$2,$3,$4,$5::jsonb)", [row.id, sourceType, candidate.sourceId, candidate.sourceUrl, JSON.stringify(candidate.raw)]);
  }
  if (candidate.rawText && candidate.rawText.length > 20) {
    await q(
      `INSERT INTO documents (candidate_id, type, file_name, raw_text, source_type, source_id, is_primary_cv)
       VALUES ($1,'import', $2, $3, $4, $5, true)`,
      [row.id, `${candidate.fullName} - importacion`, candidate.rawText.slice(0, 50000), sourceType, candidate.sourceId]
    );
  }
  await q("UPDATE candidates SET source_count=(SELECT count(*)::int FROM candidate_sources WHERE candidate_id=$1) WHERE id=$1", [row.id]);
  return { created, candidate: mapCandidate(row) };
}


candidatesRouter.get("/", asyncHandler(async (req, res) => {
  await cleanupFalseGmailCandidates();
  const search = String(req.query.search ?? "");
  const params: unknown[] = [];
  let where = `WHERE duplicate_of IS NULL AND ${excludeFalseGmailCandidatesSql}`;
  if (search) {
    params.push(`%${search}%`);
    params.push(expandedSearchTerms(search));
    where += ` AND (
      full_name ILIKE $${params.length - 1}
      OR coalesce("current_role",'') ILIKE $${params.length - 1}
      OR coalesce(city,'') ILIKE $${params.length - 1}
      OR coalesce(ai_summary,'') ILIKE $${params.length - 1}
      OR EXISTS (SELECT 1 FROM unnest(ai_tags) tag WHERE tag ILIKE $${params.length - 1})
      OR EXISTS (SELECT 1 FROM unnest(email) mail WHERE mail ILIKE $${params.length - 1})
      OR EXISTS (SELECT 1 FROM unnest(phone) tel WHERE tel ILIKE $${params.length - 1})
      OR EXISTS (
        SELECT 1
        FROM unnest($${params.length}::text[]) term
        WHERE coalesce(full_name,'') || ' ' || coalesce("current_role",'') || ' ' || coalesce(city,'') || ' ' || coalesce(ai_summary,'') || ' ' || coalesce(array_to_string(ai_tags,' '),'') ILIKE term
      )
      OR EXISTS (
        SELECT 1
        FROM documents d
        WHERE d.candidate_id = candidates.id
          AND (
            coalesce(d.raw_text,'') ILIKE $${params.length - 1}
            OR coalesce(d.file_name,'') ILIKE $${params.length - 1}
            OR EXISTS (SELECT 1 FROM unnest($${params.length}::text[]) term WHERE coalesce(d.raw_text,'') || ' ' || coalesce(d.file_name,'') ILIKE term)
          )
      )
    )`;
  }
  const [{ rows }, total] = await Promise.all([
    q(
      `SELECT candidates.*,
        (SELECT count(*)::int FROM documents d WHERE d.candidate_id = candidates.id) AS document_count,
        (SELECT d.file_name FROM documents d WHERE d.candidate_id = candidates.id ORDER BY d.is_primary_cv DESC, d.created_at DESC LIMIT 1) AS primary_document_name
       FROM candidates ${where}
       ORDER BY updated_at DESC
       LIMIT 100`,
      params
    ),
    q<{ count: string }>(`SELECT count(*)::text FROM candidates WHERE duplicate_of IS NULL AND ${excludeFalseGmailCandidatesSql}`)
  ]);
  res.json({ data: rows.map(mapCandidate), meta: { total: Number(total.rows[0]?.count ?? 0), returned: rows.length } });
}));

candidatesRouter.post("/", requireRole("recruiter"), asyncHandler(async (req, res) => {
  const body = candidateSchema.parse(req.body);
  const { rows } = await q(
    `INSERT INTO candidates (full_name, first_name, last_name, email, phone, city, country, linkedin_url, "current_role",
      ai_seniority, ai_seniority_years, ai_tags, ai_languages, ai_summary, ai_strengths, ai_weaknesses, quality_score, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18)
     RETURNING *`,
    [body.fullName, body.firstName, body.lastName, body.email, body.phone, body.city, body.country, body.linkedinUrl,
      body.currentRole, body.seniority, body.years, body.tags, JSON.stringify(body.languages), body.summary,
      body.strengths, body.weaknesses, body.qualityScore, body.status]
  );
  await q("INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES ($1,'create','candidate',$2)", [req.user!.id, rows[0].id]);
  res.status(201).json({ data: mapCandidate(rows[0]) });
}));

candidatesRouter.post("/import", requireRole("recruiter"), asyncHandler(async (req, res) => {
  const body = importSchema.parse(req.body);
  const rows = rowsFromImportData(body.data).slice(0, 5000);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const imported = [];

  for (const sourceRow of rows) {
    const candidate = candidateFromRow(sourceRow, body.sourceType);
    if (!candidate) {
      skipped += 1;
      continue;
    }
    const saved = await upsertImportedCandidate(body.sourceType, candidate);
    if (saved.created) created += 1;
    else updated += 1;
    imported.push(saved.candidate);
  }

  await q("INSERT INTO audit_logs (user_id, action, entity_type) VALUES ($1,'import','candidate')", [req.user!.id]);
  res.status(201).json({ data: imported, meta: { total: rows.length, created, updated, skipped } });
}));

candidatesRouter.get("/:id", asyncHandler(async (req, res) => {
  const { rows } = await q("SELECT * FROM candidates WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Candidato no encontrado" });
  const [work, education, documents, processes, sources] = await Promise.all([
    q("SELECT * FROM candidate_work_history WHERE candidate_id=$1 ORDER BY is_current DESC, start_date DESC NULLS LAST", [req.params.id]),
    q("SELECT * FROM candidate_education WHERE candidate_id=$1 ORDER BY end_year DESC NULLS LAST", [req.params.id]),
    q("SELECT * FROM documents WHERE candidate_id=$1 ORDER BY created_at DESC", [req.params.id]),
    q("SELECT * FROM candidate_processes WHERE candidate_id=$1 ORDER BY event_date DESC NULLS LAST", [req.params.id]),
    q("SELECT * FROM candidate_sources WHERE candidate_id=$1 ORDER BY last_synced_at DESC", [req.params.id])
  ]);
  res.json({ data: mapCandidate(rows[0]), work: work.rows, education: education.rows, documents: documents.rows, processes: processes.rows, sources: sources.rows });
}));

candidatesRouter.get("/:id/documents/:documentId/download", asyncHandler(async (req, res) => {
  const { rows } = await q(
    `SELECT id, candidate_id, file_name, file_url, mime_type, source_type, source_id, source_path
     FROM documents
     WHERE id=$1 AND candidate_id=$2
     LIMIT 1`,
    [req.params.documentId, req.params.id]
  );
  const document = rows[0];
  if (!document) return res.status(404).json({ error: "Documento no encontrado" });

  if (document.source_type === "gmail" && cleanText(document.source_id).startsWith("gmail:")) {
    const [, messageId, attachmentId] = cleanText(document.source_id).split(":");
    if (!messageId || !attachmentId) return res.status(404).json({ error: "El documento no tiene adjunto descargable guardado." });

    const integration = await q<{ config: Record<string, unknown> }>("SELECT config FROM integrations WHERE id='gmail' LIMIT 1");
    const token = await googleAccessTokenFromConfig(integration.rows[0]?.config ?? {});
    if (!token) return res.status(401).json({ error: "Gmail necesita reconexion OAuth para descargar este adjunto." });

    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.data) return res.status(502).json({ error: "Gmail no devolvio el archivo adjunto." });
    const buffer = decodeBase64UrlBuffer(String(payload.data));
    res.setHeader("content-type", document.mime_type || "application/octet-stream");
    res.setHeader("content-disposition", `attachment; filename="${cleanText(document.file_name) || "cv"}"`);
    return res.send(buffer);
  }

  if (document.file_url || document.source_path) {
    return res.redirect(document.file_url || document.source_path);
  }
  return res.status(404).json({ error: "Este documento no tiene archivo descargable." });
}));

candidatesRouter.patch("/:id", requireRole("recruiter"), asyncHandler(async (req, res) => {
  const body = candidateSchema.partial().parse(req.body);
  const current = await q("SELECT * FROM candidates WHERE id=$1", [req.params.id]);
  if (!current.rowCount) return res.status(404).json({ error: "Candidato no encontrado" });
  const merged = { ...mapCandidate(current.rows[0]), ...body };
  const { rows } = await q(
    `UPDATE candidates SET full_name=$1, first_name=$2, last_name=$3, email=$4, phone=$5, city=$6, country=$7,
      linkedin_url=$8, "current_role"=$9, ai_seniority=$10, ai_seniority_years=$11, ai_tags=$12, ai_languages=$13::jsonb,
      ai_summary=$14, ai_strengths=$15, ai_weaknesses=$16, quality_score=$17, status=$18, updated_at=now()
     WHERE id=$19 RETURNING *`,
    [merged.fullName, merged.firstName, merged.lastName, merged.email, merged.phone, merged.city, merged.country,
      merged.linkedinUrl, merged.currentRole, merged.seniority, merged.years, merged.tags, JSON.stringify(merged.languages),
      merged.summary, merged.strengths, merged.weaknesses, merged.qualityScore, merged.status, req.params.id]
  );
  await q("INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES ($1,'update','candidate',$2)", [req.user!.id, req.params.id]);
  res.json({ data: mapCandidate(rows[0]) });
}));

candidatesRouter.delete("/:id", requireRole("admin"), asyncHandler(async (req, res) => {
  await q("DELETE FROM candidates WHERE id=$1", [req.params.id]);
  await q("INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES ($1,'delete','candidate',$2)", [req.user!.id, req.params.id]);
  res.status(204).end();
}));

const childSchemas: Record<string, any> = {
  work: z.object({ company: z.string().min(1), position: z.string().min(1), startDate: z.string().optional().nullable(), endDate: z.string().optional().nullable(), isCurrent: z.boolean().default(false), description: z.string().optional().nullable(), location: z.string().optional().nullable() }),
  education: z.object({ institution: z.string().min(1), degree: z.string().optional().nullable(), field: z.string().optional().nullable(), startYear: z.number().int().optional().nullable(), endYear: z.number().int().optional().nullable(), isCompleted: z.boolean().optional().nullable() }),
  documents: z.object({ type: z.string().min(1), fileName: z.string().min(1), fileUrl: z.string().optional().nullable(), sourceType: z.string().optional().nullable(), isPrimaryCv: z.boolean().default(false) }),
  processes: z.object({ processName: z.string().min(1), client: z.string().min(1), stage: z.string().min(1), eventDate: z.string().optional().nullable(), notes: z.string().optional().nullable() })
};

candidatesRouter.post("/:id/:child(work|education|documents|processes)", requireRole("recruiter"), asyncHandler(async (req, res) => {
  const child = String(req.params.child);
  const body = childSchemas[child].parse(req.body);
  let result;
  if (child === "work") result = await q("INSERT INTO candidate_work_history (candidate_id, company, position, start_date, end_date, is_current, description, location) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [req.params.id, body.company, body.position, body.startDate || null, body.endDate || null, body.isCurrent, body.description, body.location]);
  if (child === "education") result = await q("INSERT INTO candidate_education (candidate_id, institution, degree, field, start_year, end_year, is_completed) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *", [req.params.id, body.institution, body.degree, body.field, body.startYear, body.endYear, body.isCompleted]);
  if (child === "documents") result = await q("INSERT INTO documents (candidate_id, type, file_name, file_url, source_type, is_primary_cv) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [req.params.id, body.type, body.fileName, body.fileUrl, body.sourceType, body.isPrimaryCv]);
  if (child === "processes") result = await q("INSERT INTO candidate_processes (candidate_id, process_name, client, stage, event_date, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [req.params.id, body.processName, body.client, body.stage, body.eventDate || null, body.notes]);
  res.status(201).json({ data: result!.rows[0] });
}));
