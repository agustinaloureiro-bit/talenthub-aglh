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


candidatesRouter.get("/", asyncHandler(async (req, res) => {
  const search = String(req.query.search ?? "");
  const params: unknown[] = [];
  let where = "WHERE duplicate_of IS NULL";
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
    q(`SELECT * FROM candidates ${where} ORDER BY updated_at DESC LIMIT 100`, params),
    q<{ count: string }>("SELECT count(*)::text FROM candidates WHERE duplicate_of IS NULL")
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
