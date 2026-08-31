import crypto from "node:crypto";
import { Router, type Response } from "express";
import { z } from "zod";
import { config, isAllowedGoogleEmail } from "../config.js";
import { q } from "../db/pool.js";
import { asyncHandler } from "../middleware/errors.js";
import { getDatabaseStatus } from "../db/status.js";
import {
  createSessionToken,
  OAUTH_STATE_COOKIE,
  parseCookieHeader,
  requireAuth,
  SESSION_COOKIE,
  sessionCookieOptions
} from "../middleware/auth.js";

export const authRouter = Router();

const googleProfileSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean(),
  name: z.string().min(1),
  picture: z.string().url().optional()
});

function appOrigin() {
  return new URL(config.googleCallbackUrl).origin;
}

function authErrorRedirect(res: Response, reason: "domain" | "inactive" | "oauth" | "database") {
  res.redirect(303, `${appOrigin()}/login?auth_error=${reason}`);
}

authRouter.get("/google", (_req, res) => {
  if (getDatabaseStatus().state === "unavailable") return authErrorRedirect(res, "database");
  const state = crypto.randomBytes(32).toString("base64url");
  res.cookie(OAUTH_STATE_COOKIE, state, {
    ...sessionCookieOptions(),
    maxAge: 10 * 60 * 1000
  });
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleCallbackUrl,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account"
  });
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

authRouter.get("/google/callback", asyncHandler(async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const expectedState = parseCookieHeader(req.headers.cookie)[OAUTH_STATE_COOKIE] ?? "";
  res.clearCookie(OAUTH_STATE_COOKIE, sessionCookieOptions());

  const stateMatches = state.length === expectedState.length
    && state.length > 0
    && crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expectedState));
  if (!code || !stateMatches) return authErrorRedirect(res, "oauth");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: config.googleCallbackUrl,
      grant_type: "authorization_code"
    })
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({})) as { access_token?: string };
  if (!tokenResponse.ok || !tokenPayload.access_token) return authErrorRedirect(res, "oauth");

  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokenPayload.access_token}` }
  });
  const parsedProfile = googleProfileSchema.safeParse(await profileResponse.json().catch(() => ({})));
  if (!profileResponse.ok || !parsedProfile.success || !parsedProfile.data.email_verified) {
    return authErrorRedirect(res, "oauth");
  }

  const profile = parsedProfile.data;
  const email = profile.email.trim().toLowerCase();
  if (!isAllowedGoogleEmail(email)) return authErrorRedirect(res, "domain");

  const { rows: activeAdmins } = await q(
    `SELECT email FROM users WHERE role = 'admin' AND is_active = true`
  );
  const bootstrapRole = activeAdmins.some((admin) => isAllowedGoogleEmail(String(admin.email)))
    ? "viewer"
    : "admin";

  const { rows } = await q(
    `INSERT INTO users (name, email, role, avatar_url, google_subject, last_login_at)
     VALUES (
       $1, $2,
       $5::user_role,
       $3, $4, now()
     )
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       avatar_url = EXCLUDED.avatar_url,
       google_subject = EXCLUDED.google_subject,
       role = CASE WHEN EXCLUDED.role = 'admin'::user_role THEN EXCLUDED.role ELSE users.role END,
       last_login_at = now(),
       updated_at = now()
     RETURNING id, name, email, role, is_active, avatar_url`,
    [profile.name.trim(), email, profile.picture ?? null, profile.sub, bootstrapRole]
  );
  const user = rows[0];
  if (!user.is_active) return authErrorRedirect(res, "inactive");

  res.cookie(SESSION_COOKIE, createSessionToken({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatar_url
  }), sessionCookieOptions());
  res.redirect(303, appOrigin());
}));

authRouter.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  res.status(204).end();
});
