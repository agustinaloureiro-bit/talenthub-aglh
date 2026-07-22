import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret";
process.env.ADMIN_EMAIL ??= "admin@example.com";
process.env.ADMIN_PASSWORD ??= "password";

test("convierte un talento real de Yoiners con CV", async () => {
  const { yoinersCandidateFromTalent } = await import("../dist/services/yoinersClient.js");
  const candidate = yoinersCandidateFromTalent({
    _id: "talent-123",
    user: { first_name: "Valeria", last_name: "Pereira", email: "valeria@example.com", phone: "099 123 456" },
    city: { name: "Montevideo" },
    professional_experience: [{ position: "Abogada laboral", area: { name: "Legal" }, skills: [{ name: "Negociación" }] }],
    languages: [{ name: "Inglés" }],
    talent_cv: "https://files.yoiners.com/valeria.pdf"
  });

  assert.ok(candidate);
  assert.equal(candidate.fullName, "Valeria Pereira");
  assert.equal(candidate.sourceId, "yoiners:talent-123");
  assert.equal(candidate.currentRole, "Abogada laboral");
  assert.deepEqual(candidate.email, ["valeria@example.com"]);
  assert.equal(candidate.documents[0].fileUrl, "https://files.yoiners.com/valeria.pdf");
  assert.match(candidate.summary, /Abogada laboral/);
});

test("rechaza registros Yoiners sin CV o sin nombre de persona", async () => {
  const { yoinersCandidateFromTalent } = await import("../dist/services/yoinersClient.js");
  assert.equal(yoinersCandidateFromTalent({ _id: "1", first_name: "Ana", last_name: "Pérez" }), null);
  assert.equal(yoinersCandidateFromTalent({ _id: "2", full_name: "Oferta Auxiliar", talent_cv: "https://files.yoiners.com/offer.pdf" }), null);
});

test("reutiliza una sesión exportada de Cookie-Editor", async () => {
  const { yoinersSessionFromConfig } = await import("../dist/services/yoinersClient.js");
  const session = yoinersSessionFromConfig({
    sessionCookies: JSON.stringify([
      { name: "UserToken", value: "saved-access" },
      { name: "RefreshToken", value: "saved-refresh" },
      { name: "UserId", value: "saved-user" },
      { name: "UserRole", value: "YOINER" }
    ])
  });

  assert.deepEqual(session, {
    token: "saved-access",
    refreshToken: "saved-refresh",
    userId: "saved-user",
    role: "YOINER",
    companyId: ""
  });
});

test("sincroniza la API paginada vigente de Yoiners, guarda sesion e importa solo perfiles con CV", async () => {
  const { syncYoiners } = await import("../dist/services/yoinersClient.js");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/auth/login")) {
      return new Response(JSON.stringify({ data: { token: "access-1", refresh_token: "refresh-1", user_id: "user-1", role: "YOINER" } }), { status: 200 });
    }
    if (String(url).includes("getTalentsByFilters/user-1")) {
      const body = JSON.parse(init.body);
      if (body.page === 1) return new Response(JSON.stringify({ data: { talents: [
          { _id: "with-cv", first_name: "Lucía", last_name: "Fernández", talent_cv: "https://files.yoiners.com/lucia.pdf" },
          { _id: "without-cv", first_name: "Mario", last_name: "Suárez" }
        ], hits: { totalPages: 2, totalDocs: 3 } } }), { status: 200 });
      return new Response(JSON.stringify({ data: { talents: [
        { _id: "second-page", first_name: "Valeria", last_name: "Pereira", talent_cv: "https://files.yoiners.com/valeria.pdf" }
      ], hits: { totalPages: 2, totalDocs: 3 } } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  try {
    const result = await syncYoiners({ username: "account@example.com", password: "secret" });
    assert.deepEqual(result.rows.map((candidate) => candidate.sourceId), ["yoiners:with-cv", "yoiners:second-page"]);
    assert.equal(result.configUpdate.yoinersRefreshToken, "refresh-1");
    assert.equal(result.configUpdate.sessionStatus, "connected");
    assert.match(result.message, /2 perfiles reales con CV/);
    const talentRequest = requests.find((request) => request.url.includes("getTalentsByFilters"));
    assert.equal(talentRequest.init.headers.Authorization, "bearer access-1");
    assert.equal(talentRequest.init.method, "POST");
    assert.deepEqual(JSON.parse(talentRequest.init.body), {
      role: "YOINER",
      yoiner_user_id: "user-1",
      prefetch: true,
      page: 1,
      pageMine: 1,
      pageTalents: 1,
      pageOthers: 1,
      pageFree: 1,
      limit: 100
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("usa el punto de control Yoiners y no reimporta perfiles ya vistos", async () => {
  const { selectYoinersIncrementalCandidates } = await import("../dist/services/yoinersClient.js");
  const candidates = [
    { fullName: "Nueva Persona", email: [], phone: [], tags: [], sourceId: "yoiners:new", raw: {} },
    { fullName: "Persona Conocida", email: [], phone: [], tags: [], sourceId: "yoiners:known", raw: {} },
    { fullName: "Persona Antigua", email: [], phone: [], tags: [], sourceId: "yoiners:old", raw: {} }
  ];
  const result = selectYoinersIncrementalCandidates(candidates, ["yoiners:known"]);
  assert.deepEqual(result.rows.map((candidate) => candidate.sourceId), ["yoiners:new"]);
  assert.equal(result.overlapFound, true);
});

test("renueva automaticamente una sesion Yoiners vencida", async () => {
  const { syncYoiners } = await import("../dist/services/yoinersClient.js");
  const originalFetch = globalThis.fetch;
  const authorizationHeaders = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith("/auth/refreshToken")) {
      return new Response(JSON.stringify({ data: { token: "fresh-token", refresh_token: "fresh-refresh", user_id: "user-1" } }), { status: 200 });
    }
    authorizationHeaders.push(init.headers?.Authorization);
    if (init.headers?.Authorization === "bearer expired-token") {
      return new Response(JSON.stringify({ message: "token expired" }), { status: 401 });
    }
    if (target.includes("getTalentsByFilters/user-1")) {
      return new Response(JSON.stringify({ data: [{ _id: "new", first_name: "Ana", last_name: "Rodríguez", talent_cv: "https://files.yoiners.com/ana.pdf" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  try {
    const result = await syncYoiners({
      yoinersAccessToken: "expired-token",
      yoinersRefreshToken: "saved-refresh",
      yoinersUserId: "user-1"
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.configUpdate.yoinersAccessToken, "fresh-token");
    assert.ok(authorizationHeaders.includes("bearer fresh-token"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
