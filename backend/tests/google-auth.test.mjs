import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import jwt from "jsonwebtoken";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.SESSION_SECRET = "test-session-secret";
process.env.GOOGLE_CLIENT_ID ??= "test-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-client-secret";
process.env.GOOGLE_CALLBACK_URL ??= "http://localhost:4000/api/auth/google/callback";
process.env.ALLOWED_GOOGLE_DOMAINS = "aglh.com.uy,yoiners.com";

test("permite exclusivamente los dominios corporativos exactos", async () => {
  const { isAllowedGoogleEmail } = await import("../dist/config.js");
  assert.equal(isAllowedGoogleEmail("persona@aglh.com.uy"), true);
  assert.equal(isAllowedGoogleEmail("PERSONA@YOINERS.COM"), true);
  assert.equal(isAllowedGoogleEmail("persona@gmail.com"), false);
  assert.equal(isAllowedGoogleEmail("persona@sub.aglh.com.uy"), false);
  assert.equal(isAllowedGoogleEmail("persona@aglh.com.uy.ejemplo.com"), false);
});

test("la sesión no contiene tokens de Google ni datos innecesarios", async () => {
  const { createSessionToken } = await import("../dist/middleware/auth.js");
  const token = createSessionToken({
    id: "fd627e04-9de3-4f44-9771-848507478826",
    name: "Persona AGLH",
    email: "persona@aglh.com.uy",
    role: "viewer",
    avatarUrl: "https://example.com/avatar.png"
  });
  const payload = jwt.decode(token);
  assert.equal(payload.sub, "fd627e04-9de3-4f44-9771-848507478826");
  assert.equal(payload.email, undefined);
  assert.equal(payload.access_token, undefined);
  assert.equal(payload.refresh_token, undefined);
});

test("las cookies de sesión son HttpOnly y SameSite Lax", async () => {
  const { sessionCookieOptions } = await import("../dist/middleware/auth.js");
  const options = sessionCookieOptions();
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.path, "/");
});

test("todo usuario corporativo autenticado puede sincronizar sin acceder a credenciales", async () => {
  const source = await readFile(new URL("../src/routes/integrations.ts", import.meta.url), "utf8");

  assert.match(source, /post\("\/sync-all", requireRole\("viewer"\)/);
  assert.match(source, /post\("\/:id\/sync", requireRole\("viewer"\)/);
  assert.match(source, /patch\("\/:id", requireRole\("admin"\)/);
  assert.match(source, /post\("\/:id\/google-oauth-url", requireRole\("admin"\)/);
});
