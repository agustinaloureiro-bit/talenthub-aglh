import { Router } from "express";
import { z } from "zod";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { searchTalent } from "./search.js";

export const intelligenceRouter = Router();

const searchSchema = z.object({
  query: z.string().min(1),
  filters: z.object({
    source: z.array(z.string()).optional(),
    seniority: z.string().optional(),
    activeOnly: z.boolean().optional()
  }).default({})
});

intelligenceRouter.post("/search", asyncHandler(async (req, res) => {
  const body = searchSchema.parse(req.body);
  const result = await searchTalent(body.query, body.filters);

  const saved = await q<{ id: string }>(
    `INSERT INTO intelligence_searches (user_id, query, interpreted_query, filters, mode, result_count)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id`,
    [req.user!.id, body.query, JSON.stringify(result.query), JSON.stringify(body.filters), result.mode, result.data.length]
  );

  for (const [index, candidate] of result.data.entries()) {
    await q(
      `INSERT INTO intelligence_search_results (search_id, candidate_id, score, rank_position, explanation)
       VALUES ($1,$2,$3,$4,$5)`,
      [saved.rows[0].id, candidate.id, candidate.score, index + 1, candidate.matchReason]
    );
  }

  res.json({ searchId: saved.rows[0].id, ...result });
}));

intelligenceRouter.get("/searches/:id", asyncHandler(async (req, res) => {
  const search = await q("SELECT * FROM intelligence_searches WHERE id=$1 AND user_id=$2", [req.params.id, req.user!.id]);
  if (!search.rows[0]) return res.status(404).json({ error: "Busqueda no encontrada" });
  const results = await q(
    `SELECT r.*, c.full_name, c.current_role, c.city, c.country, c.ai_tags, c.quality_score
     FROM intelligence_search_results r
     LEFT JOIN candidates c ON c.id = r.candidate_id
     WHERE r.search_id=$1
     ORDER BY r.rank_position`,
    [req.params.id]
  );
  res.json({ data: search.rows[0], results: results.rows });
}));