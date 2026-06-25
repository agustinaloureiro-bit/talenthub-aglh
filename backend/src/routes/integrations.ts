import { Router } from "express";
import { z } from "zod";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { requireRole } from "../middleware/auth.js";

export const integrationsRouter = Router();

type CandidateImport = {
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string[];
  phone: string[];
  city?: string | null;
  country?: string | null;
  linkedinUrl?: string | null;
  currentRole?: string | null;
  seniority?: string | null;
  years?: number | null;
  tags: string[];
  summary?: string | null;
  qualityScore: number;
  sourceId?: string | null;
  sourceUrl?: string | null;
  raw: Record<string, unknown>;
};

function maskConfig(config: Record<string, unknown> | null) {
  if (!config) return {};
  const masked = { ...config };
  for (const key of Object.keys(masked)) {
    if (/password|token|secret|cookie|session|key/i.test(key) && masked[key]) {
      masked[key] = "********";
    }
  }
  return masked;
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function textOrNull(value: unknown) {
  const text = cleanText(value);
  return text ? text : null;
}

function firstText(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const direct = textOrNull(row[key]);
    if (direct) return direct;
    const found = Object.keys(row).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (found) {
      const value = textOrNull(row[found]);
      if (value) return value;
    }
  }
  return null;
}

function listFrom(value: unknown) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return cleanText(value)
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const separator = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(separator).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(separator).map((value) => value.trim());
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function rowsFromConfig(config: Record<string, unknown>) {
  const direct = config.records ?? config.candidates;
  if (Array.isArray(direct)) {
    return direct.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }

  const raw = cleanText(config.historicalData ?? config.rawData ?? config.exportData ?? config.sessionCookies);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
    }
    if (Array.isArray(parsed?.candidates)) {
      return parsed.candidates.filter((item: unknown): item is Record<string, unknown> => typeof item === "object" && item !== null);
    }
    if (Array.isArray(parsed?.records)) {
      return parsed.records.filter((item: unknown): item is Record<string, unknown> => typeof item === "object" && item !== null);
    }
  } catch {
    return parseCsv(raw);
  }

  return [];
}

function normalizeCandidate(row: Record<string, unknown>, sourceType: string): CandidateImport | null {
  const fullName = firstText(row, ["fullName", "full_name", "name", "nombre", "candidate", "candidato"]);
  const firstName = firstText(row, ["firstName", "first_name", "nombre"]);
  const lastName = firstText(row, ["lastName", "last_name", "apellido"]);
  const email = unique(listFrom(row.email ?? row.emails ?? row.mail ?? row.correo));
  const phone = unique(listFrom(row.phone ?? row.phones ?? row.telefono ?? row.celular ?? row.mobile));
  const resolvedName = fullName ?? unique([firstName ?? "", lastName ?? ""]).join(" ").trim();

  if (!resolvedName && email.length === 0 && phone.length === 0) return null;

  const yearsText = firstText(row, ["years", "yearsExperience", "experiencia_anios", "anos", "anios"]);
  const years = yearsText && Number.isFinite(Number(yearsText)) ? Number(yearsText) : null;

  return {
    fullName: resolvedName || email[0] || phone[0],
    firstName,
    lastName,
    email,
    phone,
    city: firstText(row, ["city", "ciudad", "location", "ubicacion"]),
    country: firstText(row, ["country", "pais"]),
    linkedinUrl: firstText(row, ["linkedinUrl", "linkedin_url", "linkedin"]),
    currentRole: firstText(row, ["currentRole", "current_role", "role", "cargo", "puesto", "position"]),
    seniority: firstText(row, ["seniority", "seniorityLevel", "nivel"]),
    years,
    tags: unique(listFrom(row.tags ?? row.skills ?? row.habilidades ?? sourceType)),
    summary: firstText(row, ["summary", "resumen", "notes", "notas"]),
    qualityScore: 0,
    sourceId: firstText(row, ["id", "sourceId", "source_id", "candidateId", "candidate_id"]),
    sourceUrl: firstText(row, ["url", "sourceUrl", "source_url", "profileUrl", "profile_url"]),
    raw: row
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

async function importCandidate(sourceType: string, candidate: CandidateImport) {
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
    await q(
      `UPDATE candidates SET
        full_name=coalesce($1, full_name),
        first_name=coalesce($2, first_name),
        last_name=coalesce($3, last_name),
        email=(SELECT array_agg(DISTINCT value) FROM unnest(email || $4::text[]) AS value),
        phone=(SELECT array_agg(DISTINCT value) FROM unnest(phone || $5::text[]) AS value),
        city=coalesce($6, city),
        country=coalesce($7, country),
        linkedin_url=coalesce($8, linkedin_url),
        "current_role"=coalesce($9, "current_role"),
        ai_seniority=coalesce($10, ai_seniority),
        ai_seniority_years=coalesce($11, ai_seniority_years),
        ai_tags=(SELECT array_agg(DISTINCT value) FROM unnest(ai_tags || $12::text[]) AS value),
        ai_summary=coalesce($13, ai_summary),
        updated_at=now(),
        last_seen_at=now()
       WHERE id=$14`,
      [candidate.fullName, candidate.firstName, candidate.lastName, candidate.email, candidate.phone, candidate.city,
        candidate.country, candidate.linkedinUrl, candidate.currentRole, candidate.seniority, candidate.years,
        candidate.tags, candidate.summary, existingId]
    );
    await saveSource(existingId, sourceType, candidate);
    return "updated";
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
  return "new";
}

integrationsRouter.get("/", asyncHandler(async (_req, res) => {
  const [integrations, logs] = await Promise.all([
    q("SELECT * FROM integrations ORDER BY name"),
    q("SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 20")
  ]);
  res.json({ data: integrations.rows.map((row) => ({ ...row, config: maskConfig(row.config) })), logs: logs.rows });
}));

integrationsRouter.patch("/:id", requireRole("admin"), asyncHandler(async (req, res) => {
  const body = z.object({
    status: z.enum(["not_configured", "connected", "warning", "error", "soon"]).optional(),
    config: z.record(z.any()).optional()
  }).parse(req.body);
  const { rows } = await q(
    "UPDATE integrations SET status=coalesce($1,status), config=config || coalesce($2::jsonb,'{}'::jsonb), updated_at=now() WHERE id=$3 RETURNING *",
    [body.status, body.config ? JSON.stringify(body.config) : null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Integracion no encontrada" });
  res.json({ data: { ...rows[0], config: maskConfig(rows[0].config) } });
}));

integrationsRouter.post("/:id/sync", requireRole("recruiter"), asyncHandler(async (req, res) => {
  const integrationId = String(req.params.id);
  const integration = await q("SELECT * FROM integrations WHERE id=$1", [integrationId]);
  if (!integration.rowCount) return res.status(404).json({ error: "Integracion no encontrada" });

  const started = Date.now();
  const config = integration.rows[0].config ?? {};
  const hasConfig = Object.values(config).some((value) => String(value ?? "").trim().length > 0);
  const rowsToImport = rowsFromConfig(config);
  let status = integration.rows[0].status === "connected" && hasConfig ? "warning" : "error";
  let message = status === "warning"
    ? "Credenciales guardadas. Para traer historico ahora, pega un exportado JSON o CSV en Datos historicos y volve a sincronizar."
    : "La integracion necesita estado Conectado y al menos una credencial, sesion o exportado guardado.";
  let newRecords = 0;
  let updatedRecords = 0;
  let errors = 0;

  if (rowsToImport.length > 0) {
    for (const row of rowsToImport) {
      const candidate = normalizeCandidate(row, integrationId);
      if (!candidate) {
        errors += 1;
        continue;
      }
      const result = await importCandidate(integrationId, candidate);
      if (result === "new") newRecords += 1;
      if (result === "updated") updatedRecords += 1;
    }
    status = errors > 0 ? "warning" : "success";
    message = `Historico procesado: ${newRecords} nuevos, ${updatedRecords} actualizados, ${errors} omitidos.`;
  }

  const { rows } = await q(
    "INSERT INTO sync_logs (integration_id, source, finished_at, duration_ms, status, new_records, updated_records, errors, message) VALUES ($1,$2,now(),$3,$4,$5,$6,$7,$8) RETURNING *",
    [integrationId, integration.rows[0].name, Date.now() - started, status, newRecords, updatedRecords, errors, message]
  );
  await q(
    "UPDATE integrations SET last_sync_at=now(), total_imported=total_imported+$1, updated_at=now(), status=$2 WHERE id=$3",
    [newRecords, status === "error" ? "error" : "connected", integrationId]
  );
  res.status(201).json({ data: rows[0] });
}));
