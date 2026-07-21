import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret";
process.env.ADMIN_EMAIL ??= "admin@example.com";
process.env.ADMIN_PASSWORD ??= "password";

test("convierte un talento real de AGLH con CV y experiencia", async () => {
  const { aglhCandidateFromTalent } = await import("../dist/services/aglhClient.js");
  const candidate = aglhCandidateFromTalent({
    user_id: "talent-123",
    first_name: "Valeria",
    last_name: "Pereira",
    email: "valeria@example.com",
    phone: "099 123 456",
    city: { name: "Montevideo" },
    professional_experience: [{ position: "Abogada laboral", area: { name: "Legal" }, knowledge: [{ name: "Negociación" }] }],
    languages: [{ name: "Inglés" }],
    cv: { url: "https://files.aglh.com.uy/valeria.pdf", file_name: "Valeria Pereira.pdf" }
  });

  assert.ok(candidate);
  assert.equal(candidate.fullName, "Valeria Pereira");
  assert.equal(candidate.sourceId, "aglh:talent-123");
  assert.equal(candidate.currentRole, "Abogada laboral");
  assert.deepEqual(candidate.email, ["valeria@example.com"]);
  assert.equal(candidate.documents[0].fileUrl, "https://files.aglh.com.uy/valeria.pdf");
  assert.match(candidate.summary, /Abogada laboral/);
});

test("no importa registros AGLH sin CV", async () => {
  const { aglhCandidateFromTalent } = await import("../dist/services/aglhClient.js");
  assert.equal(aglhCandidateFromTalent({
    user_id: "talent-456",
    first_name: "Ana",
    last_name: "García",
    email: "ana@example.com"
  }), null);
});

test("no confunde una oferta con una persona", async () => {
  const { aglhCandidateFromTalent } = await import("../dist/services/aglhClient.js");
  assert.equal(aglhCandidateFromTalent({
    id: "offer-1",
    full_name: "Oferta Auxiliar Administrativo",
    cv_url: "https://files.aglh.com.uy/oferta.pdf"
  }), null);
});

test("reconoce el campo talent_cv de la API oficial AGLH", async () => {
  const { aglhCandidateFromTalent } = await import("../dist/services/aglhClient.js");
  const candidate = aglhCandidateFromTalent({
    _id: "talent-789",
    first_name: "Lucia",
    last_name: "Fernandez",
    talent_cv: "https://files.aglh.com.uy/lucia-fernandez.pdf"
  });

  assert.ok(candidate);
  assert.equal(candidate.sourceId, "aglh:talent-789");
  assert.equal(candidate.documents[0].fileUrl, "https://files.aglh.com.uy/lucia-fernandez.pdf");
});

test("AGLH incremental se detiene al encontrar el ultimo perfil conocido", async () => {
  const { selectAglhIncrementalCandidates } = await import("../dist/services/aglhClient.js");
  const candidates = [
    { fullName: "Nueva Persona", email: [], phone: [], tags: [], sourceId: "aglh:new", raw: {} },
    { fullName: "Persona Conocida", email: [], phone: [], tags: [], sourceId: "aglh:known", raw: {} },
    { fullName: "Persona Antigua", email: [], phone: [], tags: [], sourceId: "aglh:older", raw: {} }
  ];

  const result = selectAglhIncrementalCandidates(candidates, ["aglh:known", "aglh:previous"]);

  assert.deepEqual(result.rows.map((candidate) => candidate.sourceId), ["aglh:new"]);
  assert.equal(result.overlapFound, true);
  assert.deepEqual(result.headIds.slice(0, 3), ["aglh:new", "aglh:known", "aglh:older"]);
});

test("AGLH incremental establece una referencia inicial sin recorrer todo otra vez", async () => {
  const { selectAglhIncrementalCandidates } = await import("../dist/services/aglhClient.js");
  const candidates = [
    { fullName: "Primera Persona", email: [], phone: [], tags: [], sourceId: "aglh:first", raw: {} },
    { fullName: "Segunda Persona", email: [], phone: [], tags: [], sourceId: "aglh:second", raw: {} }
  ];

  const result = selectAglhIncrementalCandidates(candidates, []);

  assert.equal(result.rows.length, 2);
  assert.equal(result.overlapFound, false);
  assert.deepEqual(result.headIds, ["aglh:first", "aglh:second"]);
});

test("AGLH usa solo la ventana reciente despues de completar el historico", async () => {
  const { syncAglh } = await import("../dist/services/aglhClient.js");
  const originalFetch = globalThis.fetch;
  const requestedPages = [];
  const talent = (id, firstName, lastName) => ({
    user_id: id,
    first_name: firstName,
    last_name: lastName,
    talent_cv: `https://files.aglh.com.uy/${id}.pdf`
  });
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith("/login")) {
      return new Response(JSON.stringify({ data: { token: "test-token" } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const page = Number(JSON.parse(String(init.body)).page);
    requestedPages.push(page);
    const rows = page === 1
      ? [talent("new", "Nueva", "Persona"), talent("known", "Persona", "Conocida")]
      : [talent(`old-${page}`, "Persona", `Antigua${page}`)];
    return new Response(JSON.stringify({ data: { total: 100, talents: rows } }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const result = await syncAglh({
      username: "account@example.com",
      password: "secret",
      aglhBackfillCompleteAt: "2026-07-20T12:00:00.000Z",
      aglhNextPage: 201,
      aglhHeadSourceIds: ["aglh:known"],
      aglhCvDownloadsPerSync: 0
    });

    assert.deepEqual(requestedPages.sort((a, b) => a - b), [1, 2, 3]);
    assert.deepEqual(result.rows.map((candidate) => candidate.sourceId), ["aglh:new"]);
    assert.match(result.message, /AGLH incremental/);
    assert.equal(result.configUpdate.aglhNextPage, 1);
    assert.ok(result.configUpdate.aglhLastIncrementalSyncAt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
