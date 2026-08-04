import { Router } from "express";
import { z } from "zod";
import { isAllowedGoogleEmail } from "../config.js";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { requireRole } from "../middleware/auth.js";

export const usersRouter = Router();

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  role: z.enum(["admin", "recruiter", "viewer"])
});

usersRouter.get("/", requireRole("admin"), asyncHandler(async (_req, res) => {
  const { rows } = await q(
    `SELECT id, name, email, role, is_active AS "isActive", avatar_url AS "avatarUrl",
            last_login_at AS "lastLoginAt", created_at AS "createdAt"
     FROM users
     ORDER BY created_at DESC`
  );
  res.json({ data: rows });
}));

usersRouter.post("/", requireRole("admin"), asyncHandler(async (req, res) => {
  const body = createUserSchema.parse(req.body);
  const email = body.email.toLowerCase();
  if (!isAllowedGoogleEmail(email)) {
    return res.status(400).json({ error: "El email debe pertenecer a un dominio autorizado." });
  }

  const existing = await q("SELECT 1 FROM users WHERE email = $1", [email]);
  if (existing.rowCount) return res.status(409).json({ error: "Ya existe un usuario con ese email." });

  const { rows } = await q(
    `INSERT INTO users (name, email, role)
     VALUES ($1, $2, $3)
     RETURNING id, name, email, role, is_active AS "isActive", avatar_url AS "avatarUrl",
               last_login_at AS "lastLoginAt", created_at AS "createdAt"`,
    [body.name, email, body.role]
  );
  res.status(201).json({ data: rows[0] });
}));
