import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errors.js";
import { authRouter } from "./routes/auth.js";
import { candidatesRouter } from "./routes/candidates.js";
import { integrationsPublicRouter, integrationsRouter, startDocumentBackfillWorker } from "./routes/integrations.js";
import { settingsRouter } from "./routes/settings.js";
import { searchRouter } from "./routes/search.js";
import { usersRouter } from "./routes/users.js";
import { intelligenceRouter } from "./routes/intelligence.js";
import { migrate } from "./db/migrate.js";
import { databaseErrorDetail, getDatabaseStatus, setDatabaseStatus } from "./db/status.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const release = "2026-08-31.1";

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      frameSrc: ["'self'", "blob:"],
      imgSrc: ["'self'", "data:", "blob:", "https://lh3.googleusercontent.com"]
    }
  }
}));
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use((pinoHttp as any)());
app.use(rateLimit({ windowMs: 60_000, limit: 300 }));

app.get("/health", (_req, res) => {
  const database = getDatabaseStatus();
  res.json({
    ok: true,
    release,
    commit: process.env.RENDER_GIT_COMMIT?.slice(0, 12) ?? null,
    database: { state: database.state, checkedAt: database.checkedAt }
  });
});
app.get("/ready", (_req, res) => {
  const database = getDatabaseStatus();
  res.status(database.state === "ready" ? 200 : 503).json({
    ready: database.state === "ready",
    database: { state: database.state, checkedAt: database.checkedAt }
  });
});
app.use("/api/auth", authRouter);
app.use("/api/candidates", requireAuth, candidatesRouter);
app.use("/api/search", requireAuth, searchRouter);
app.use("/api/intelligence", requireAuth, intelligenceRouter);
app.use("/api/integrations", requireAuth, integrationsPublicRouter, integrationsRouter);
app.use("/api/settings", requireAuth, settingsRouter);
app.use("/api/users", requireAuth, usersRouter);

if (process.env.SERVE_STATIC === "true") {
  const publicDir = path.resolve(__dirname, "../public");
  app.use(express.static(publicDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

app.use(errorHandler);

let databaseInitializationRunning = false;
let documentWorkerStarted = false;

async function initializeDatabase() {
  if (databaseInitializationRunning) return;
  databaseInitializationRunning = true;
  setDatabaseStatus("migrating");
  try {
    await migrate();
    setDatabaseStatus("ready");
    if (!documentWorkerStarted) {
      documentWorkerStarted = true;
      startDocumentBackfillWorker();
    }
    console.log("Database ready");
  } catch (error) {
    const detail = databaseErrorDetail(error);
    setDatabaseStatus("unavailable", detail);
    console.error("Database initialization failed; the server will keep running and retry", detail);
  } finally {
    databaseInitializationRunning = false;
  }
}

app.listen(config.port, () => {
  console.log(`Talent Hub API listening on ${config.port}`);
  void initializeDatabase();
  const retryTimer = setInterval(() => {
    if (getDatabaseStatus().state !== "ready") void initializeDatabase();
  }, 60_000);
  retryTimer.unref();
});
