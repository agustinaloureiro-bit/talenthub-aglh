import { Router } from "express";
import { z } from "zod";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { searchTalent } from "./search.js";
import { candidateDisplayLocation, candidateDisplayName } from "../services/candidatePresentation.js";

export const seasonRouter = Router();

const SEASON_RECENCY_FILTER = "730d" as const;
const SEASON_RESULT_LIMIT = 300;
const SEASON_RECENT_SOURCE_CONDITION = `EXISTS (
  SELECT 1
  FROM candidate_sources season_recent_source
  WHERE season_recent_source.candidate_id=c.id
    AND season_recent_source.is_active=true
    AND season_recent_source.source_created_at >= now() - interval '2 years'
)`;

const seasonSearchSchema = z.object({
  name: z.string().trim().min(3),
  department: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  radiusKm: z.number().int().min(0).max(250).optional().nullable(),
  role: z.string().trim().min(2),
  experienceLevel: z.string().trim().optional().nullable(),
  keywords: z.array(z.string().trim()).default([]),
  excludeKeywords: z.array(z.string().trim()).default([])
});

function cleanList(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 40);
}

function seasonQuery(search: any) {
  const parts = [
    search.role,
    search.experience_level,
    cleanList(search.keywords ?? []).join(", "),
    search.city || search.department ? `Ubicacion: ${[search.city, search.department].filter(Boolean).join(", ")}` : "",
    search.radius_km ? `zonas cercanas en un radio aproximado de ${search.radius_km} km` : ""
  ];
  return parts.filter(Boolean).join(". ");
}

function normalized(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : String(value ?? "");
}

function candidateContainsExcluded(candidate: any, excludeKeywords: string[]) {
  const exclusions = cleanList(excludeKeywords).map(normalized).filter(Boolean);
  if (!exclusions.length) return false;
  const searchable = normalized([
    candidate.fullName,
    candidate.currentRole,
    candidate.city,
    candidate.country,
    candidate.summary,
    candidate.documentSnippet,
    ...(candidate.tags ?? [])
  ].filter(Boolean).join(" "));
  return exclusions.some((term) => searchable.includes(term));
}

function cleanScore(value: unknown) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function cleanOptionalText(value: unknown, maxLength = 500) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function cleanTextArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))].slice(0, 20);
}

function mapSeason(row: any) {
  return {
    id: row.id,
    name: row.name,
    department: row.department,
    city: row.city,
    radiusKm: row.radius_km,
    role: row.role,
    experienceLevel: row.experience_level,
    keywords: row.keywords ?? [],
    excludeKeywords: row.exclude_keywords ?? [],
    queryText: row.query_text,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
    resultCount: Number(row.result_count ?? 0),
    reservedCount: Number(row.reserved_count ?? 0),
    myReservedCount: Number(row.my_reserved_count ?? 0)
  };
}

function mapSeasonResult(row: any, viewerId?: string) {
  return {
    id: row.result_id,
    score: Number(row.score ?? 0),
    matchReason: row.match_reason,
    sourceTypes: row.result_source_types ?? [],
    profileUrl: row.profile_url,
    firstFoundAt: row.first_found_at,
    lastFoundAt: row.last_found_at,
    reservedAt: row.reserved_at,
    reservedBy: row.reserved_by,
    reservedByName: row.reserved_by_name,
    reservedByEmail: row.reserved_by_email,
    isReservedByMe: Boolean(row.reserved_by && viewerId && row.reserved_by === viewerId),
    candidate: {
      id: row.candidate_id,
      fullName: candidateDisplayName(row.full_name),
      email: row.email ?? [],
      phone: row.phone ?? [],
      city: candidateDisplayLocation(row.city),
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
      sourceCount: Number(row.source_count ?? 0),
      sourceTypes: row.candidate_source_types ?? row.result_source_types ?? [],
      documentCount: Number(row.document_count ?? 0),
      primaryDocumentName: row.primary_document_name ?? null,
      primaryDocumentId: row.primary_document_id ?? null,
      primaryDocumentMimeType: row.primary_document_mime_type ?? null,
      primaryDocumentSourceType: row.primary_document_source_type ?? null,
      documentSnippet: row.document_snippet ?? null,
      status: row.status,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at ?? row.updated_at,
      latestSourceAt: row.latest_source_at ?? null
    }
  };
}

async function getSeasonList(viewerId: string) {
  const { rows } = await q(
    `SELECT ss.*,
      count(ssr.id) FILTER (WHERE c.id IS NOT NULL AND ${SEASON_RECENT_SOURCE_CONDITION})::int AS result_count,
      count(ssr.id) FILTER (WHERE c.id IS NOT NULL AND ${SEASON_RECENT_SOURCE_CONDITION} AND ssr.reserved_at IS NOT NULL)::int AS reserved_count,
      count(ssr.id) FILTER (WHERE c.id IS NOT NULL AND ${SEASON_RECENT_SOURCE_CONDITION} AND ssr.reserved_by=$1)::int AS my_reserved_count
     FROM season_searches ss
     LEFT JOIN season_search_results ssr ON ssr.season_search_id=ss.id
     LEFT JOIN candidates c ON c.id=ssr.candidate_id AND c.duplicate_of IS NULL
     WHERE ss.status <> 'archived'
     GROUP BY ss.id
     ORDER BY ss.updated_at DESC, ss.created_at DESC`,
    [viewerId]
  );
  return rows.map(mapSeason);
}

async function getSeasonDetail(id: string, viewerId: string) {
  const { rows: searchRows } = await q(
    `SELECT ss.*,
      count(ssr.id) FILTER (WHERE c.id IS NOT NULL AND ${SEASON_RECENT_SOURCE_CONDITION})::int AS result_count,
      count(ssr.id) FILTER (WHERE c.id IS NOT NULL AND ${SEASON_RECENT_SOURCE_CONDITION} AND ssr.reserved_at IS NOT NULL)::int AS reserved_count,
      count(ssr.id) FILTER (WHERE c.id IS NOT NULL AND ${SEASON_RECENT_SOURCE_CONDITION} AND ssr.reserved_by=$2)::int AS my_reserved_count
     FROM season_searches ss
     LEFT JOIN season_search_results ssr ON ssr.season_search_id=ss.id
     LEFT JOIN candidates c ON c.id=ssr.candidate_id AND c.duplicate_of IS NULL
     WHERE ss.id=$1
     GROUP BY ss.id`,
    [id, viewerId]
  );
  const search = searchRows[0];
  if (!search) return null;
  const { rows: resultRows } = await q(
    `WITH document_counts AS (
       SELECT d.candidate_id, count(*)::int AS document_count
       FROM documents d
       JOIN season_search_results ssr ON ssr.candidate_id=d.candidate_id
       WHERE ssr.season_search_id=$1
       GROUP BY d.candidate_id
     ), primary_documents AS (
       SELECT DISTINCT ON (d.candidate_id)
         d.candidate_id,
         d.id,
         d.file_name,
         d.mime_type,
         d.source_type,
         d.raw_text
       FROM documents d
       JOIN season_search_results ssr ON ssr.candidate_id=d.candidate_id
       WHERE ssr.season_search_id=$1
       ORDER BY d.candidate_id, d.is_primary_cv DESC, d.created_at DESC
     ), source_summary AS (
       SELECT cs.candidate_id,
         count(DISTINCT cs.source_type)::int AS source_count,
         array_agg(DISTINCT cs.source_type ORDER BY cs.source_type) AS source_types,
         max(cs.source_created_at) AS latest_source_at
       FROM candidate_sources cs
       JOIN season_search_results ssr ON ssr.candidate_id=cs.candidate_id
       WHERE ssr.season_search_id=$1 AND cs.is_active=true
       GROUP BY cs.candidate_id
     )
     SELECT ssr.id AS result_id,
       ssr.score,
       ssr.match_reason,
       ssr.source_types AS result_source_types,
       ssr.profile_url,
       ssr.first_found_at,
       ssr.last_found_at,
       ssr.reserved_at,
       ssr.reserved_by,
       reserved_user.name AS reserved_by_name,
       reserved_user.email AS reserved_by_email,
       c.id AS candidate_id,
       c.*,
       coalesce(source_summary.source_count, 0)::int AS source_count,
       coalesce(source_summary.source_types, '{}'::text[]) AS candidate_source_types,
       source_summary.latest_source_at,
       coalesce(document_counts.document_count, 0)::int AS document_count,
       primary_documents.id AS primary_document_id,
       primary_documents.file_name AS primary_document_name,
       primary_documents.mime_type AS primary_document_mime_type,
       primary_documents.source_type AS primary_document_source_type,
       left(coalesce(primary_documents.raw_text, ''), 1200) AS document_snippet
     FROM season_search_results ssr
     JOIN candidates c ON c.id=ssr.candidate_id
     LEFT JOIN users reserved_user ON reserved_user.id=ssr.reserved_by
     LEFT JOIN document_counts ON document_counts.candidate_id=c.id
     LEFT JOIN primary_documents ON primary_documents.candidate_id=c.id
     LEFT JOIN source_summary ON source_summary.candidate_id=c.id
     WHERE ssr.season_search_id=$1
       AND c.duplicate_of IS NULL
       AND ${SEASON_RECENT_SOURCE_CONDITION}
     ORDER BY
       CASE
         WHEN ssr.reserved_at IS NULL THEN 0
         WHEN ssr.reserved_by=$2 THEN 1
         ELSE 2
       END,
       ssr.score DESC,
       ssr.last_found_at DESC
     LIMIT ${SEASON_RESULT_LIMIT}`,
    [id, viewerId]
  );
  return { search: mapSeason(search), results: resultRows.map((row) => mapSeasonResult(row, viewerId)) };
}

seasonRouter.get("/", asyncHandler(async (req, res) => {
  res.json({ data: await getSeasonList(req.user!.id) });
}));

seasonRouter.post("/", asyncHandler(async (req, res) => {
  const body = seasonSearchSchema.parse(req.body);
  const values = {
    ...body,
    keywords: cleanList(body.keywords),
    excludeKeywords: cleanList(body.excludeKeywords)
  };
  const queryText = seasonQuery({
    role: values.role,
    experience_level: values.experienceLevel,
    department: values.department,
    city: values.city,
    radius_km: values.radiusKm,
    keywords: values.keywords
  });
  const { rows } = await q(
    `INSERT INTO season_searches (name, department, city, radius_km, role, experience_level, keywords, exclude_keywords, query_text, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [values.name, values.department ?? null, values.city ?? null, values.radiusKm ?? null, values.role, values.experienceLevel ?? null, values.keywords, values.excludeKeywords, queryText, req.user!.id]
  );
  res.status(201).json({ data: mapSeason({ ...rows[0], result_count: 0, reserved_count: 0, my_reserved_count: 0 }) });
}));

seasonRouter.get("/:id", asyncHandler(async (req, res) => {
  const detail = await getSeasonDetail(routeParam(req.params.id), req.user!.id);
  if (!detail) return res.status(404).json({ error: "Búsqueda de temporada no encontrada" });
  res.json({ data: detail });
}));

seasonRouter.patch("/:id", asyncHandler(async (req, res) => {
  const body = seasonSearchSchema.partial().parse(req.body);
  const id = routeParam(req.params.id);
  const { rows } = await q("SELECT * FROM season_searches WHERE id=$1", [id]);
  const current = rows[0];
  if (!current) return res.status(404).json({ error: "Búsqueda de temporada no encontrada" });
  const next = {
    name: body.name ?? current.name,
    department: body.department ?? current.department,
    city: body.city ?? current.city,
    radiusKm: body.radiusKm ?? current.radius_km,
    role: body.role ?? current.role,
    experienceLevel: body.experienceLevel ?? current.experience_level,
    keywords: body.keywords ? cleanList(body.keywords) : current.keywords,
    excludeKeywords: body.excludeKeywords ? cleanList(body.excludeKeywords) : current.exclude_keywords
  };
  const queryText = seasonQuery({
    role: next.role,
    experience_level: next.experienceLevel,
    department: next.department,
    city: next.city,
    radius_km: next.radiusKm,
    keywords: next.keywords
  });
  const updated = await q(
    `UPDATE season_searches
     SET name=$2, department=$3, city=$4, radius_km=$5, role=$6, experience_level=$7, keywords=$8, exclude_keywords=$9, query_text=$10, updated_at=now()
     WHERE id=$1
     RETURNING *`,
    [id, next.name, next.department, next.city, next.radiusKm, next.role, next.experienceLevel, next.keywords, next.excludeKeywords, queryText]
  );
  res.json({ data: mapSeason({ ...updated.rows[0], result_count: 0, reserved_count: 0, my_reserved_count: 0 }) });
}));

seasonRouter.post("/:id/run", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const { rows } = await q("SELECT * FROM season_searches WHERE id=$1", [id]);
  const search = rows[0];
  if (!search) return res.status(404).json({ error: "Búsqueda de temporada no encontrada" });
  const queryText = seasonQuery(search);
  let result;
  try {
    result = await searchTalent(queryText, {
      location: search.city || search.department || undefined,
      activeOnly: true,
      recency: SEASON_RECENCY_FILTER,
      sort: "relevance"
    });
  } catch (error: any) {
    if (error?.code === "57014") return res.status(503).json({ error: "La búsqueda demoró demasiado. Probá ejecutar con menos palabras clave." });
    throw error;
  }
  const candidates = result.data
    .filter((candidate) => !candidateContainsExcluded(candidate, search.exclude_keywords ?? []))
    .slice(0, SEASON_RESULT_LIMIT);
  let imported = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const candidateId = cleanOptionalText(candidate.id, 80);
    if (!candidateId) {
      skipped += 1;
      continue;
    }
    try {
      await q(
        `INSERT INTO season_search_results (season_search_id, candidate_id, score, match_reason, source_types, profile_url)
         VALUES ($1,$2,$3,$4,$5::text[],$6)
         ON CONFLICT (season_search_id, candidate_id)
         DO UPDATE SET score=EXCLUDED.score,
           match_reason=EXCLUDED.match_reason,
           source_types=EXCLUDED.source_types,
           profile_url=coalesce(EXCLUDED.profile_url, season_search_results.profile_url),
           last_found_at=now()`,
        [
          search.id,
          candidateId,
          cleanScore(candidate.score),
          cleanOptionalText(candidate.matchReason, 1000),
          cleanTextArray(candidate.sourceTypes),
          null
        ]
      );
      imported += 1;
    } catch (error) {
      skipped += 1;
      console.error("Season candidate import skipped", {
        seasonSearchId: search.id,
        candidateId,
        error
      });
    }
  }
  await q(
    "UPDATE season_searches SET query_text=$2, last_run_at=now(), updated_at=now() WHERE id=$1",
    [search.id, queryText]
  );
  const detail = await getSeasonDetail(search.id, req.user!.id);
  res.json({
    data: detail,
    meta: {
      reviewed: result.data.length,
      imported,
      excluded: result.data.length - candidates.length,
      skipped
    }
  });
}));

seasonRouter.post("/:id/results/:candidateId/reserve", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const candidateId = routeParam(req.params.candidateId);
  const { rows } = await q(
    `INSERT INTO season_search_results (season_search_id, candidate_id, reserved_at, reserved_by)
     VALUES ($1,$2,now(),$3)
     ON CONFLICT (season_search_id, candidate_id)
     DO UPDATE SET reserved_at=now(),
       reserved_by=EXCLUDED.reserved_by,
       last_found_at=now()
     WHERE season_search_results.reserved_by IS NULL
       OR season_search_results.reserved_by=EXCLUDED.reserved_by
     RETURNING *`,
    [id, candidateId, req.user!.id]
  );
  if (!rows[0]) {
    const existing = await q(
      `SELECT users.name AS reserved_by_name, users.email AS reserved_by_email
       FROM season_search_results ssr
       LEFT JOIN users ON users.id=ssr.reserved_by
       WHERE ssr.season_search_id=$1 AND ssr.candidate_id=$2`,
      [id, candidateId]
    );
    const reservation = existing.rows[0];
    const reserver = reservation?.reserved_by_name || reservation?.reserved_by_email || "otro reclutador";
    return res.status(409).json({ error: `Este candidato ya fue reservado por ${reserver}.` });
  }
  res.json({ data: rows[0] });
}));

seasonRouter.delete("/:id/results/:candidateId/reserve", asyncHandler(async (req, res) => {
  const id = routeParam(req.params.id);
  const candidateId = routeParam(req.params.candidateId);
  const { rows } = await q(
    `UPDATE season_search_results
     SET reserved_at=NULL, reserved_by=NULL, last_found_at=now()
     WHERE season_search_id=$1 AND candidate_id=$2 AND reserved_by=$3
     RETURNING *`,
    [id, candidateId, req.user!.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "No encontré una reserva tuya para liberar." });
  res.json({ data: rows[0] });
}));
