import { Router } from "express";
import { z } from "zod";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { searchTalent } from "./search.js";

export const chatRouter = Router();

chatRouter.get("/sessions", asyncHandler(async (req, res) => {
  const { rows } = await q("SELECT * FROM chat_sessions WHERE user_id=$1 ORDER BY updated_at DESC", [req.user!.id]);
  res.json({ data: rows });
}));

chatRouter.post("/sessions", asyncHandler(async (req, res) => {
  const title = z.object({ title: z.string().min(1).default("Nueva conversacion") }).parse(req.body).title;
  const { rows } = await q("INSERT INTO chat_sessions (user_id, title) VALUES ($1,$2) RETURNING *", [req.user!.id, title]);
  res.status(201).json({ data: rows[0] });
}));

chatRouter.get("/sessions/:id/messages", asyncHandler(async (req, res) => {
  const { rows } = await q("SELECT * FROM chat_messages WHERE session_id=$1 ORDER BY created_at", [req.params.id]);
  res.json({ data: rows });
}));

chatRouter.post("/sessions/:id/messages", asyncHandler(async (req, res) => {
  const body = z.object({ content: z.string().min(1) }).parse(req.body);
  await q("INSERT INTO chat_messages (session_id, role, content) VALUES ($1,'user',$2)", [req.params.id, body.content]);
  const result = await searchTalent(body.content, { activeOnly: true });
  const matches = result.data;
  const refs = matches.slice(0, 5).map((m) => m.id);
  const content = refs.length
    ? `${result.explanation} Te muestro los primeros ${Math.min(5, refs.length)} perfiles y la razon de compatibilidad en cada resultado.`
    : result.explanation;
  const { rows } = await q(
    "INSERT INTO chat_messages (session_id, role, content, candidate_refs) VALUES ($1,'assistant',$2,$3) RETURNING *",
    [req.params.id, content, refs]
  );
  await q("UPDATE chat_sessions SET title=left($1,80), updated_at=now() WHERE id=$2", [body.content, req.params.id]);
  res.status(201).json({ data: rows[0], candidates: matches.slice(0, 5), query: result.query, mode: result.mode });
}));