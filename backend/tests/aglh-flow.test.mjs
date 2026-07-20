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
