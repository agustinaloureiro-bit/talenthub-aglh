import { Router } from "express";
import { z } from "zod";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";

export const searchRouter = Router();

const searchSchema = z.object({
  query: z.string().min(1),
  filters: z.object({
    source: z.array(z.string()).optional(),
    seniority: z.string().optional(),
    activeOnly: z.boolean().optional()
  }).default({})
});

export async function findCandidates(query: string, filters: any = {}) {
  const params: unknown[] = [query];
  let where = "WHERE c.duplicate_of IS NULL";
  if (filters.activeOnly) where += " AND c.status='active'";
  if (filters.seniority) {
    params.push(filters.seniority);
    where += ` AND c.ai_seniority = $${params.length}`;
  }
  if (filters.source?.length) {
    params.push(filters.source);
    where += ` AND EXISTS (SELECT 1 FROM candidate_sources cs WHERE cs.candidate_id=c.id AND cs.source_type = ANY($${params.length}))`;
  }
  const { rows } = await q(
    `SELECT c.*,
      ts_rank_cd(to_tsvector('spanish', coalesce(c.full_name,'') || ' ' || coalesce(c.current_role,'') || ' ' || coalesce(c.ai_summary,'') || ' ' || array_to_string(c.ai_tags,' ')), plainto_tsquery('spanish', $1)) AS rank
     FROM candidates c
     ${where}
     ORDER BY rank DESC, c.quality_score DESC, c.updated_at DESC
     LIMIT 20`,
    params
  );
  return rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    currentRole: row.current_role,
    city: row.city,
    country: row.country,
    seniority: row.ai_seniority,
    years: row.ai_seniority_years,
    tags: row.ai_tags ?? [],
    qualityScore: row.quality_score,
    score: Math.min(100, Math.max(0, Math.round((Number(row.rank) * 60) + (row.quality_score * 0.4)))),
    matchReason: row.rank > 0 ? "Coincide por texto, rol, competencias o resumen registrado." : "Sin coincidencia semántica directa; ordenado por calidad del perfil."
  }));
}

searchRouter.post("/talent", asyncHandler(async (req, res) => {
  const body = searchSchema.parse(req.body);
  await q("INSERT INTO saved_searches (user_id, query, filters) VALUES ($1,$2,$3)", [req.user!.id, body.query, JSON.stringify(body.filters)]);
  const data = await findCandidates(body.query, body.filters);
  res.json({ data });
}));
