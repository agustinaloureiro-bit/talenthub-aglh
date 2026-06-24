import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { requireAuth, signToken } from "../middleware/auth.js";

export const authRouter = Router();

authRouter.post("/login", asyncHandler(async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const { rows } = await q("SELECT id, name, email, password_hash, role, is_active FROM users WHERE email = lower($1)", [body.email]);
  const user = rows[0];
  if (!user || !user.is_active || !(await bcrypt.compare(body.password, user.password_hash))) {
    return res.status(401).json({ error: "Credenciales inválidas" });
  }
  const payload = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.json({ token: signToken(payload), user: payload });
}));

authRouter.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));
