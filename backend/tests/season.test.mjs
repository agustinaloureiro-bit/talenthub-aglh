import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/talenthub_test";
process.env.SESSION_SECRET ??= "test-secret";
process.env.GOOGLE_CLIENT_ID ??= "test-client";
process.env.GOOGLE_CLIENT_SECRET ??= "test-secret";
process.env.GOOGLE_CALLBACK_URL ??= "http://localhost:4000/api/auth/google/callback";
process.env.ALLOWED_GOOGLE_DOMAINS ??= "aglh.com.uy,yoiners.com";

const { candidateContainsExcluded, isEntryLevelSeason } = await import("../dist/routes/season.js");

test("season exclusions only block the primary profile, not isolated historical CV mentions", () => {
  const operationalCandidate = {
    fullName: "Persona Operativa",
    currentRole: "Repositor / cajero",
    tags: ["supermercado", "atencion al cliente"],
    documentSnippet: "Fue encargado eventual durante una licencia, pero su perfil principal es repositor."
  };

  assert.equal(candidateContainsExcluded(operationalCandidate, ["encargado", "jefe", "supervisor"]), false);
});

test("season exclusions still block clearly managerial primary profiles", () => {
  const managerialCandidate = {
    fullName: "Persona Supervisora",
    currentRole: "Jefe de tienda",
    tags: ["supermercado", "liderazgo"],
    documentSnippet: "Experiencia en caja y reposición."
  };

  assert.equal(candidateContainsExcluded(managerialCandidate, ["jefe", "supervisor"]), true);
});

test("season search recognizes broad junior operational campaigns", () => {
  assert.equal(isEntryLevelSeason({
    role: "Auxiliar de supermercado",
    experience_level: "Junior / poca experiencia",
    keywords: ["repositor", "caja", "atención al cliente"]
  }), true);
});

test("season search does not broaden specialized senior campaigns", () => {
  assert.equal(isEntryLevelSeason({
    role: "Gerente comercial",
    experience_level: "Senior",
    keywords: ["liderazgo", "estrategia"]
  }), false);
});
