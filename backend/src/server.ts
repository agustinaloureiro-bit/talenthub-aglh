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
import { dashboardRouter } from "./routes/dashboard.js";
import { integrationsRouter } from "./routes/integrations.js";
import { settingsRouter } from "./routes/settings.js";
import { searchRouter } from "./routes/search.js";
import { chatRouter } from "./routes/chat.js";
import { usersRouter } from "./routes/users.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(helmet());
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use((pinoHttp as any)());
app.use(rateLimit({ windowMs: 60_000, limit: 300 }));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/dashboard", requireAuth, dashboardRouter);
app.use("/api/candidates", requireAuth, candidatesRouter);
app.use("/api/search", requireAuth, searchRouter);
app.use("/api/integrations", requireAuth, integrationsRouter);
app.use("/api/settings", requireAuth, settingsRouter);
app.use("/api/chat", requireAuth, chatRouter);
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

app.listen(config.port, () => {
  console.log(`Talent Hub API listening on ${config.port}`);
});
