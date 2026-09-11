import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { q } from "../db/pool.js";

export type Role = "admin" | "recruiter" | "viewer";

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  name: string;
  avatarUrl?: string | null;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const SESSION_COOKIE = "talenthub_session";
export const OAUTH_STATE_COOKIE = "talenthub_oauth_state";
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_WINDOW_SECONDS = 7 * 24 * 60 * 60;

export function parseCookieHeader(header: string | undefined) {
  return Object.fromEntries((header ?? "").split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 1) return [];
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      return [[key, decodeURIComponent(value)]];
    } catch {
      return [[key, value]];
    }
  }));
}

export function createSessionToken(user: AuthUser) {
  return jwt.sign({ sub: user.id }, config.sessionSecret, {
    expiresIn: "30d",
    issuer: "talenthub-aglh",
    audience: "talenthub-web"
  });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DURATION_MS
  };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = parseCookieHeader(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: "No autenticado" });

  try {
    const payload = jwt.verify(token, config.sessionSecret, {
      issuer: "talenthub-aglh",
      audience: "talenthub-web"
    }) as jwt.JwtPayload;
    if (typeof payload.sub !== "string") return res.status(401).json({ error: "Sesión inválida" });

    const { rows } = await q(
      `SELECT id, name, email, role, avatar_url
       FROM users
       WHERE id = $1 AND is_active = true`,
      [payload.sub]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Sesión inactiva" });
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatar_url
    };
    const secondsRemaining = typeof payload.exp === "number"
      ? payload.exp - Math.floor(Date.now() / 1000)
      : 0;
    if (secondsRemaining < SESSION_REFRESH_WINDOW_SECONDS) {
      res.cookie(SESSION_COOKIE, createSessionToken(req.user), sessionCookieOptions());
    }
    next();
  } catch {
    res.status(401).json({ error: "Sesión inválida o expirada" });
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
