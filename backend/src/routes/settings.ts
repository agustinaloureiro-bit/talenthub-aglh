import { Router } from "express";
import { z } from "zod";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { requireRole } from "../middleware/auth.js";

export const settingsRouter = Router();

settingsRouter.get("/", asyncHandler(async (_req, res) => {
  const { rows } = await q("SELECT key, value FROM app_settings ORDER BY key");
  res.json({ data: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
}));

settingsRouter.patch("/:key", requireRole("admin"), asyncHandler(async (req, res) => {
  const body = z.object({ value: z.record(z.any()) }).parse(req.body);
  const { rows } = await q(
    "UPDATE app_settings SET value=$1::jsonb, updated_at=now(), updated_by=$2 WHERE key=$3 RETURNING key,value",
    [JSON.stringify(body.value), req.user!.id, req.params.key]
  );
  if (!rows[0]) return res.status(404).json({ error: "Configuración no encontrada" });
  res.json({ data: rows[0] });
}));
