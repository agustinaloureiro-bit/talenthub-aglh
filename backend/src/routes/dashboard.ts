import { Router } from "express";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";

export const dashboardRouter = Router();

dashboardRouter.get("/", asyncHandler(async (_req, res) => {
  const [candidates, weekly, activeProcesses, integrations, logs] = await Promise.all([
    q("SELECT count(*)::int AS total FROM candidates WHERE duplicate_of IS NULL"),
    q("SELECT count(*)::int AS total FROM candidates WHERE created_at >= now() - interval '7 days'"),
    q("SELECT count(*)::int AS total FROM processes WHERE status='active'"),
    q("SELECT count(*)::int AS total FROM integrations WHERE status IN ('connected','warning')"),
    q("SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 10")
  ]);
  res.json({
    metrics: {
      totalCandidates: candidates.rows[0].total,
      newThisWeek: weekly.rows[0].total,
      activeProcesses: activeProcesses.rows[0].total,
      connectedSources: integrations.rows[0].total
    },
    syncLogs: logs.rows
  });
}));
