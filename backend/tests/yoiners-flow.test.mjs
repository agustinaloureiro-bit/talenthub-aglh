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

test("usa la vista oficial de empresa aunque la vista Yoiner devuelva cero talentos", async () => {
  const { syncYoiners } = await import("../dist/services/yoinersClient.js");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    requests.push({ url: target, init });
    if (target.endsWith("/auth/login")) {
      return new Response(JSON.stringify({
        data: { token: "company-access", refresh_token: "company-refresh", user_id: "team-user" }
      }), { status: 200 });
    }
    if (target.includes("/company/getCompanyByTeamUser/team-user")) {
      return new Response(JSON.stringify({ data: { _id: "team-record", company_id: "company-1" } }), { status: 200 });
    }
    if (target.includes("/company/getTalentsByFiltersCompany/company-1")) {
      const body = JSON.parse(init.body);
      assert.equal(body.role, "COMPANY_TEAM");
      assert.equal(body.company_id, "company-1");
      if (body.pageMine === 1) {
        return new Response(JSON.stringify({ data: { hits: {
          totalPages: 1,
          mine: [
            { _id: "company-talent", first_name: "María", last_name: "Gómez", talent_cv: "https://files.yoiners.com/maria.pdf" },
            { _id: "company-talent-2", user: { first_name: "Sofía", last_name: "Silva" }, talent_cv: "https://files.yoiners.com/sofia.pdf" }
          ]
        } } }), { status: 200 });
      }
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  try {
    const result = await syncYoiners({ username: "company@example.com", password: "secret" });
    assert.deepEqual(result.rows.map((candidate) => candidate.sourceId), ["yoiners:company-talent", "yoiners:company-talent-2"]);
    assert.equal(result.configUpdate.yoinersRole, "COMPANY_TEAM");
    assert.equal(result.configUpdate.yoinersCompanyId, "company-1");
    assert.ok(requests.some((request) => request.url.includes("/company/getTalentsByFiltersCompany/company-1")));
    assert.ok(requests.some((request) => request.url.includes("/company/getSharedTalents/company-1")));
    assert.ok(requests.some((request) => request.url.includes("/company/getCompanyByTeamUser/team-user")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("abre el detalle de cada talento de empresa cuando el listado no incluye el CV", async () => {
  const { syncYoiners } = await import("../dist/services/yoinersClient.js");
  const originalFetch = globalThis.fetch;
  const detailIds = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith("/auth/me")) {
      return new Response(JSON.stringify({
        data: { user_id: "team-user", role: "COMPANY_TEAM", company_id: "company-1" }
      }), { status: 200 });
    }
    if (target.includes("/company/getTalentsByFiltersCompany/company-1")) {
      return new Response(JSON.stringify({
        data: {
          talents: [
            { user_id: "talent-1", first_name: "Ana", last_name: "Pereira", created_at: "2026-07-22T10:00:00Z" },
            { user_id: "talent-2", first_name: "Luis", last_name: "Gómez", created_at: "2026-07-21T10:00:00Z" }
          ],
          hits: { totalPages: 1, totalDocs: 2 }
        }
      }), { status: 200 });
    }
    const detail = target.match(/\/talent\/(talent-\d+)\/company-1$/);
    if (detail) {
      detailIds.push(detail[1]);
      return new Response(JSON.stringify({
        data: {
          user_id: detail[1],
          first_name: detail[1] === "talent-1" ? "Ana" : "Luis",
          last_name: detail[1] === "talent-1" ? "Pereira" : "Gómez",
          talent_cv: `https://files.yoiners.com/${detail[1]}.pdf`
        }
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  try {
    const result = await syncYoiners({
      yoinersAccessToken: "company-access",
      yoinersUserId: "team-user",
      yoinersRole: "COMPANY_TEAM",
      yoinersCompanyId: "company-1"
    });

    assert.deepEqual(detailIds.sort(), ["talent-1", "talent-2"]);
    assert.deepEqual(result.rows.map((candidate) => candidate.sourceId).sort(), ["yoiners:talent-1", "yoiners:talent-2"]);
    assert.equal(result.configUpdate.yoinersCursorVersion, "talent-views-v2");
    assert.equal(result.configUpdate.yoinersTotalVisible, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("una sincronizacion posterior de empresa abre solo talentos nuevos", async () => {
  const { syncYoiners } = await import("../dist/services/yoinersClient.js");
  const originalFetch = globalThis.fetch;
  const detailIds = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/company/getTalentsByFiltersCompany/company-1")) {
      return new Response(JSON.stringify({
        data: {
          talents: [
            { user_id: "talent-new", first_name: "Nueva", last_name: "Persona", created_at: "2026-07-23T10:00:00Z" },
            { user_id: "talent-known", first_name: "Persona", last_name: "Conocida", created_at: "2026-07-20T10:00:00Z" }
          ],
          hits: { totalPages: 1, totalDocs: 2 }
        }
      }), { status: 200 });
    }
    const detail = target.match(/\/talent\/(talent-[^/]+)\/company-1$/);
    if (detail) {
      detailIds.push(detail[1]);
      return new Response(JSON.stringify({
        data: {
          user_id: detail[1],
          first_name: "Nueva",
          last_name: "Persona",
          talent_cv: `https://files.yoiners.com/${detail[1]}.pdf`,
          created_at: "2026-07-23T10:00:00Z"
        }
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  try {
    const result = await syncYoiners({
      yoinersAccessToken: "company-access",
      yoinersUserId: "team-user",
      yoinersRole: "COMPANY_TEAM",
      yoinersCompanyId: "company-1",
      yoinersCursorVersion: "talent-views-v2",
      yoinersHeadSourceIds: ["yoiners:talent-known"],
      yoinersLastSyncAt: "2026-07-22T00:00:00Z"
    });

    assert.deepEqual(detailIds, ["talent-new"]);
    assert.deepEqual(result.rows.map((candidate) => candidate.sourceId), ["yoiners:talent-new"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("completa una sesion antigua con el rol y la empresa desde auth me", async () => {
  const { syncYoiners } = await import("../dist/services/yoinersClient.js");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    requests.push(target);
    if (target.endsWith("/auth/me")) {
      return new Response(JSON.stringify({ data: { user_id: "team-user", role: "COMPANY_TEAM", company_id: "company-1" } }), { status: 200 });
    }
    if (target.includes("/company/getTalentsByFiltersCompany/company-1")) {
      return new Response(JSON.stringify({ data: [{
        _id: "legacy-session-talent", first_name: "Ana", last_name: "Pereira", talent_cv: "https://files.yoiners.com/ana.pdf"
      }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  try {
    const result = await syncYoiners({ yoinersAccessToken: "saved-token", yoinersUserId: "team-user" });
    assert.deepEqual(result.rows.map((candidate) => candidate.sourceId), ["yoiners:legacy-session-talent"]);
    assert.equal(result.configUpdate.yoinersRole, "COMPANY_TEAM");
    assert.equal(result.configUpdate.yoinersCompanyId, "company-1");
    assert.ok(requests.some((target) => target.endsWith("/auth/me")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sincroniza todos los talentos visibles para una cuenta auditora", async () => {
  const { syncYoiners } = await import("../dist/services/yoinersClient.js");
  const originalFetch = globalThis.fetch;
  const requestedPages = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith("/auth/me")) {
      return new Response(JSON.stringify({ data: { user_id: "auditor-1", role: "AUDITOR", permissions: [] } }), { status: 200 });
    }
    if (target.endsWith("/auditor/getAuditsByFilters")) {
      const body = JSON.parse(init.body);
      requestedPages.push(body.page);
      const audits = body.page === 1
        ? [
            { id: 1, talent: { user_id: "talent-1", first_name: "Ana", last_name: "Pereira", talent_cv: "https://files.yoiners.com/ana.pdf" } },
            { id: 2, talent: { user_id: "talent-1", first_name: "Ana", last_name: "Pereira", talent_cv: "https://files.yoiners.com/ana.pdf" } }
          ]
        : [{ id: 3, talent: { user_id: "talent-2", first_name: "Luis", last_name: "Gómez", talent_cv: "https://files.yoiners.com/luis.pdf" } }];
      return new Response(JSON.stringify({ audits, hits: { totalDocs: 3, totalPages: 2, page: body.page } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  try {
    const result = await syncYoiners({
      yoinersAccessToken: "auditor-token",
      yoinersUserId: "auditor-1",
      yoinersRole: "AUDITOR"
    });
    assert.deepEqual(requestedPages, [1, 2]);
    assert.deepEqual(result.rows.map((candidate) => candidate.sourceId), ["yoiners:talent-1", "yoiners:talent-2"]);
    assert.equal(result.configUpdate.yoinersTotalVisible, 2);
    assert.equal(result.configUpdate.yoinersCursorVersion, "auditor-catalog-v2");
    assert.equal(result.configUpdate.sessionStatus, "connected");
    assert.match(result.message, /2 perfiles reales con CV/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("una cuenta auditora pagina el catalogo completo y abre cada perfil para obtener su CV", async () => {
  const { syncYoiners } = await import("../dist/services/yoinersClient.js");
  const originalFetch = globalThis.fetch;
  const catalogPages = [];
  const detailIds = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith("/auth/me")) {
      return new Response(JSON.stringify({ data: { user_id: "auditor-1", role: "AUDITOR" } }), { status: 200 });
    }
    if (target.includes("/yoiner/getTalentsByFilters/auditor-1")) {
      const body = JSON.parse(init.body);
      catalogPages.push(body.page);
      assert.equal(body.yoiner_user_id, undefined);
      const talents = body.page === 1
        ? [
            { _id: "record-1", user_id: "talent-1", first_name: "Ana", last_name: "Pereira", created_at: "2026-07-20T10:00:00Z" },
            { _id: "record-2", user_id: "talent-2", first_name: "Luis", last_name: "Gómez", created_at: "2026-07-19T10:00:00Z" }
          ]
        : [{ _id: "record-3", user_id: "talent-3", first_name: "Sofía", last_name: "Silva", created_at: "2026-07-18T10:00:00Z" }];
      return new Response(JSON.stringify({ talents, talentsMeta: { totalPages: 2, totalDocs: 3, page: body.page } }), { status: 200 });
    }
    const detail = target.match(/\/talent\/(talent-\d+)\/$/);
    if (detail) {
      detailIds.push(detail[1]);
      return new Response(JSON.stringify({
        user_id: detail[1],
        first_name: detail[1] === "talent-1" ? "Ana" : detail[1] === "talent-2" ? "Luis" : "Sofía",
        last_name: detail[1] === "talent-1" ? "Pereira" : detail[1] === "talent-2" ? "Gómez" : "Silva",
        talent_cv: `https://files.yoiners.com/${detail[1]}.pdf`
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  try {
    const result = await syncYoiners({
      yoinersAccessToken: "auditor-token",
      yoinersUserId: "auditor-1",
      yoinersRole: "AUDITOR"
    });
    assert.deepEqual(catalogPages, [1, 2]);
    assert.deepEqual(detailIds.sort(), ["talent-1", "talent-2", "talent-3"]);
    assert.equal(result.rows.length, 3);
    assert.equal(result.configUpdate.yoinersTotalVisible, 3);
    assert.equal(result.configUpdate.yoinersCursorVersion, "auditor-catalog-v2");
    assert.match(result.message, /3 perfiles reales con CV/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("despues del primer recorrido Yoiners solo abre perfiles nuevos", async () => {
  const { syncYoiners } = await import("../dist/services/yoinersClient.js");
  const originalFetch = globalThis.fetch;
  const detailIds = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith("/auth/me")) {
      return new Response(JSON.stringify({ data: { user_id: "auditor-1", role: "AUDITOR" } }), { status: 200 });
    }
    if (target.includes("/yoiner/getTalentsByFilters/auditor-1")) {
      return new Response(JSON.stringify({
        talents: [
          { user_id: "talent-new", first_name: "Nueva", last_name: "Persona", created_at: "2026-07-22T10:00:00Z" },
          { user_id: "talent-known", first_name: "Persona", last_name: "Conocida", created_at: "2026-07-20T10:00:00Z" },
          { user_id: "talent-old", first_name: "Persona", last_name: "Anterior", created_at: "2026-07-18T10:00:00Z" }
        ],
        talentsMeta: { totalPages: 1, totalDocs: 3, page: JSON.parse(init.body).page }
      }), { status: 200 });
    }
    const detail = target.match(/\/talent\/(talent-[^/]+)\/$/);
    if (detail) {
      detailIds.push(detail[1]);
      return new Response(JSON.stringify({
        user_id: detail[1],
        first_name: "Nueva",
        last_name: "Persona",
        talent_cv: `https://files.yoiners.com/${detail[1]}.pdf`,
        created_at: "2026-07-22T10:00:00Z"
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  try {
    const result = await syncYoiners({
      yoinersAccessToken: "auditor-token",
      yoinersUserId: "auditor-1",
      yoinersRole: "AUDITOR",
      yoinersCursorVersion: "auditor-catalog-v2",
      yoinersHeadSourceIds: ["yoiners:talent-known"],
      yoinersLastSyncAt: "2026-07-21T10:00:00Z"
    });
    assert.deepEqual(detailIds, ["talent-new"]);
    assert.deepEqual(result.rows.map((candidate) => candidate.sourceId), ["yoiners:talent-new"]);
    assert.equal(result.configUpdate.yoinersTotalVisible, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("descarta el punto de control antiguo al habilitar la vista auditora", async () => {
  const { syncYoiners } = await import("../dist/services/yoinersClient.js");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith("/auth/me")) {
      return new Response(JSON.stringify({ data: { user_id: "auditor-1", role: "AUDITOR" } }), { status: 200 });
    }
    if (target.endsWith("/auditor/getAuditsByFilters")) {
      return new Response(JSON.stringify({
        audits: [{ id: 1, talent: { user_id: "talent-1", first_name: "Ana", last_name: "Pereira", talent_cv: "https://files.yoiners.com/ana.pdf" } }],
        hits: { totalDocs: 1, totalPages: 1, page: JSON.parse(init.body).page }
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  try {
    const result = await syncYoiners({
      yoinersAccessToken: "auditor-token",
      yoinersUserId: "auditor-1",
      yoinersRole: "AUDITOR",
      yoinersLastSyncAt: "2026-07-22T00:00:00.000Z",
      yoinersHeadSourceIds: ["yoiners:talent-1"]
    });
    assert.deepEqual(result.rows.map((candidate) => candidate.sourceId), ["yoiners:talent-1"]);
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
      yoinersUserId: "user-1",
      yoinersRole: "COMPANY",
      yoinersCompanyId: "company-1"
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.configUpdate.yoinersAccessToken, "fresh-token");
    assert.equal(result.configUpdate.yoinersRole, "COMPANY");
    assert.equal(result.configUpdate.yoinersCompanyId, "company-1");
    assert.ok(authorizationHeaders.includes("bearer fresh-token"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
