import { Router } from "express";
import { z } from "zod";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { requireRole } from "../middleware/auth.js";

export const integrationsRouter = Router();

integrationsRouter.get("/", asyncHandler(async (_req, res) => {
  const [integrations, logs] = await Promise.all([
    q("SELECT * FROM integrations ORDER BY name"),
    q("SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 20")
  ]);
  res.json({ data: integrations.rows, logs: logs.rows });
}));

integrationsRouter.patch("/:id", requireRole("admin"), asyncHandler(async (req, res) => {
  const body = z.object({
    status: z.enum(["not_configured", "connected", "warning", "error", "soon"]).optional(),
    config: z.record(z.any()).optional()
  }).parse(req.body);
  const { rows } = await q(
    "UPDATE integrations SET status=coalesce($1,status), config=coalesce($2::jsonb,config), updated_at=now() WHERE id=$3 RETURNING *",
    [body.status, body.config ? JSON.stringify(body.config) : null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Integración no encontrada" });
  res.json({ data: rows[0] });
}));

integrationsRouter.post("/:id/sync", requireRole("recruiter"), asyncHandler(async (req, res) => {
  const integration = await q("SELECT * FROM integrations WHERE id=$1", [req.params.id]);
  if (!integration.rowCount) return res.status(404).json({ error: "Integración no encontrada" });
  const status = integration.rows[0].status === "connected" || integration.rows[0].status === "warning" ? "success" : "error";
  const message = status === "success" ? "Sincronización registrada. No se importaron registros porque no hay conector externo configurado." : "La integración requiere configuración válida antes de sincronizar.";
  const { rows } = await q(
    "INSERT INTO sync_logs (integration_id, source, finished_at, duration_ms, status, message) VALUES ($1,$2,now(),0,$3,$4) RETURNING *",
    [req.params.id, integration.rows[0].name, status, message]
  );
  await q("UPDATE integrations SET last_sync_at=now(), updated_at=now() WHERE id=$1", [req.params.id]);
  res.status(201).json({ data: rows[0] });
}));
