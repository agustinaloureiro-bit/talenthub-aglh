import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export type Role = "admin" | "recruiter" | "viewer";

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  name: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser) {
  return jwt.sign(user, config.jwtSecret, { expiresIn: config.jwtExpiresIn as any });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No autenticado" });
  try {
    req.user = jwt.verify(token, config.jwtSecret) as AuthUser;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido o expirado" });
  }
}

const roleWeight: Record<Role, number> = { viewer: 1, recruiter: 2, admin: 3 };

export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });
    if (roleWeight[req.user.role] < roleWeight[role]) return res.status(403).json({ error: "Permiso insuficiente" });
    next();
  };
}
