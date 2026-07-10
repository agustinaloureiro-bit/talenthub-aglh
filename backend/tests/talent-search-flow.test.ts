import assert from "node:assert/strict";
import test from "node:test";
import { interpretTalentQuery } from "../src/intelligence/queryInterpreter.js";
import { rerankCandidates } from "../src/intelligence/candidateRanker.js";
import type { TalentCandidateResult } from "../src/intelligence/types.js";

test("interpreta abogado con ingles como rol e idioma", () => {
  const interpreted = interpretTalentQuery("Necesito un abogado con inglés.");

  assert.ok(interpreted.roles.includes("abogado"));
  assert.ok(interpreted.languages.includes("ingles"));
  assert.ok(interpreted.mustHave.includes("abogado"));
  assert.ok(interpreted.mustHave.includes("ingles"));
});

test("prioriza candidatos con evidencia en documentos/CV", () => {
  const interpreted = interpretTalentQuery("Necesito un abogado con inglés.");
  const candidates: TalentCandidateResult[] = [
    {
      id: "sin-cv",
      fullName: "Persona General",
      currentRole: "Administrativo",
      city: "Montevideo",
      country: "Uruguay",
      tags: ["administracion"],
      qualityScore: 70,
      score: 20,
      matchReason: ""
    },
    {
      id: "con-cv",
      fullName: "Valeria Legal",
      currentRole: "Abogada corporativa",
      city: "Montevideo",
      country: "Uruguay",
      tags: ["legal"],
      qualityScore: 65,
      sourceCount: 2,
      documentCount: 1,
      primaryDocumentName: "CV Valeria Legal.pdf",
      documentSnippet: "Abogada con experiencia en contratos, derecho corporativo e ingles avanzado.",
      score: 20,
      matchReason: ""
    }
  ];

  const ranked = rerankCandidates(candidates, interpreted);

  assert.equal(ranked[0].id, "con-cv");
  assert.match(ranked[0].matchReason, /rol alineado/i);
  assert.match(ranked[0].matchReason, /idioma/i);
  assert.match(ranked[0].matchReason, /CV\/documentos/i);
});
