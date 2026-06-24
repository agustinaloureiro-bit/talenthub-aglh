import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { requireRole } from "../middleware/auth.js";

export const usersRouter = Router();

usersRouter.get("/", requireRole("admin"), asyncHandler(async (_req, res) => {
  const { rows } = await q("SELECT id,name,email,role,is_active,created_at FROM users ORDER BY created_at DESC");
  res.json({ data: rows });
}));

usersRouter.post("/", requireRole("admin"), asyncHandler(async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(["admin", "recruiter", "viewer"])
  }).parse(req.body);
  const hash = await bcrypt.hash(body.password, 12);
  const { rows } = await q(
    "INSERT INTO users (name,email,password_hash,role) VALUES ($1,lower($2),$3,$4) RETURNING id,name,email,role,is_active,created_at",
    [body.name, body.email, hash, body.role]
  );
  res.status(201).json({ data: rows[0] });
}));
