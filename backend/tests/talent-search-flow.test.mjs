import assert from "node:assert/strict";
import test from "node:test";

const { interpretTalentQuery } = await import("../dist/intelligence/queryInterpreter.js");
const { rerankCandidates } = await import("../dist/intelligence/candidateRanker.js");
const { downloadContentDisposition } = await import("../dist/routes/candidates.js");

test("interpreta abogado con ingles como rol e idioma", () => {
  const interpreted = interpretTalentQuery("Necesito un abogado con inglés.");

  assert.ok(interpreted.roles.includes("abogado"));
  assert.ok(interpreted.languages.includes("ingles"));
  assert.ok(interpreted.mustHave.includes("abogado"));
  assert.ok(interpreted.mustHave.includes("ingles"));
});

test("genera un nombre de descarga valido para archivos con acentos combinados", () => {
  const header = downloadContentDisposition("Oscar Domínguez.pdf");

  assert.match(header, /^attachment; filename="Oscar Dominguez\.pdf";/);
  assert.match(header, /filename\*=UTF-8''Oscar%20Dom%C3%ADnguez\.pdf$/);
  assert.doesNotMatch(header.split(";")[1], /[^\x20-\x7E]/);
});

test("prioriza candidatos con evidencia en documentos/CV", () => {
  const interpreted = interpretTalentQuery("Necesito un abogado con inglés.");
  const candidates = [
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
  assert.match(ranked[0].matchReason, /área principal alineada/i);
  assert.match(ranked[0].matchReason, /idioma/i);
  assert.match(ranked[0].matchReason, /Evidencia encontrada en el CV/i);
});

test("rankea con acentos, sinonimos y resumen del perfil", () => {
  const interpreted = interpretTalentQuery("Necesito un abogado con inglés.");
  const candidates = [
    {
      id: "solo-ingles",
      fullName: "Perfil Idiomas",
      currentRole: "Administrativo",
      city: "Montevideo",
      country: "Uruguay",
      tags: ["english"],
      summary: "Atencion al cliente con English avanzado.",
      qualityScore: 80,
      sourceCount: 1,
      documentCount: 1,
      primaryDocumentName: "CV Idiomas.pdf",
      documentSnippet: "English avanzado.",
      score: 35,
      matchReason: ""
    },
    {
      id: "abogada-ingles",
      fullName: "Lucia Derecho",
      currentRole: "Asesora legal",
      city: "Montevideo",
      country: "Uruguay",
      tags: ["derecho", "inglés"],
      summary: "Abogada con experiencia en derecho laboral e inglés avanzado.",
      qualityScore: 70,
      sourceCount: 1,
      documentCount: 2,
      primaryDocumentName: "CV Lucia Derecho.pdf",
      documentSnippet: "Abogada. Derecho laboral. Inglés avanzado.",
      score: 30,
      matchReason: ""
    }
  ];

  const ranked = rerankCandidates(candidates, interpreted);

  assert.equal(ranked[0].id, "abogada-ingles");
  assert.match(ranked[0].matchReason, /área principal alineada/i);
  assert.match(ranked[0].matchReason, /idioma/i);
});

test("interpreta ventas y gastronomia aunque venga sin acento o con typo", () => {
  const interpreted = interpretTalentQuery("Busco alguien con ventas y gastonomia");

  assert.ok(interpreted.skills.includes("ventas"));
  assert.ok(interpreted.skills.includes("gastonomia"));
  assert.ok(interpreted.mustHave.includes("ventas"));
});

test("prioriza CV con experiencia en ventas y gastronomia", () => {
  const interpreted = interpretTalentQuery("ventas y gastronomia");
  const candidates = [
    {
      id: "administrativo",
      fullName: "Perfil Administrativo",
      currentRole: "Administrativa",
      city: "Montevideo",
      country: "Uruguay",
      tags: ["administracion"],
      qualityScore: 75,
      sourceCount: 1,
      documentCount: 1,
      primaryDocumentName: "CV Administrativo.pdf",
      documentSnippet: "Experiencia en recepcion, archivo y tareas administrativas.",
      score: 20,
      matchReason: ""
    },
    {
      id: "ventas-gastronomia",
      fullName: "Camila Perez",
      currentRole: "Atencion al cliente",
      city: "Montevideo",
      country: "Uruguay",
      tags: ["ventas", "gastronomia"],
      qualityScore: 65,
      sourceCount: 1,
      documentCount: 1,
      primaryDocumentName: "CV Camila Perez.pdf",
      documentSnippet: "Experiencia en ventas, gastronomia, restaurante, caja y atencion al cliente.",
      score: 20,
      matchReason: ""
    }
  ];

  const ranked = rerankCandidates(candidates, interpreted);

  assert.equal(ranked[0].id, "ventas-gastronomia");
  assert.match(ranked[0].matchReason, /competencias principales alineadas/i);
});

test("el porcentaje de match no depende de la calidad general del perfil", () => {
  const interpreted = interpretTalentQuery("abogado con ingles");
  const ranked = rerankCandidates([
    {
      id: "match-completo",
      fullName: "Lucia Derecho",
      currentRole: "Abogada",
      tags: ["abogado", "ingles"],
      email: ["lucia@example.com"],
      qualityScore: 20,
      documentCount: 1,
      documentSnippet: "Abogada corporativa con ingles avanzado.",
      score: 1,
      matchReason: ""
    },
    {
      id: "perfil-completo-pero-no-match",
      fullName: "Maria Ventas",
      currentRole: "Comercial",
      tags: ["ingles"],
      email: ["maria@example.com"],
      qualityScore: 100,
      documentCount: 1,
      documentSnippet: "Experiencia comercial. Ingles avanzado.",
      score: 99,
      matchReason: ""
    }
  ], interpreted);

  assert.equal(ranked[0].id, "match-completo");
  assert.ok(ranked[0].score > ranked[1].score);
});

test("una mención secundaria en el CV no empata con un área principal alineada", () => {
  const interpreted = interpretTalentQuery("abogado con ingles");
  const ranked = rerankCandidates([
    {
      id: "principal",
      fullName: "Lucia Derecho",
      currentRole: "Abogada",
      tags: ["abogado", "ingles"],
      email: ["lucia@example.com"],
      qualityScore: 50,
      documentCount: 1,
      documentSnippet: "Abogada corporativa con ingles avanzado.",
      score: 0,
      matchReason: ""
    },
    {
      id: "mencion",
      fullName: "Persona Logistica",
      currentRole: "Logistica",
      tags: ["logistica"],
      email: ["persona@example.com"],
      qualityScore: 90,
      documentCount: 1,
      documentSnippet: "Curso de derecho e ingles. Experiencia principal en deposito.",
      score: 0,
      matchReason: ""
    }
  ], interpreted);

  assert.equal(ranked[0].id, "principal");
  assert.equal(ranked[0].score, 100);
  assert.ok(ranked[1].score < 100);
  assert.match(ranked[1].matchReason, /no como perfil principal/i);
});

test("ventas como rol principal queda antes que una mención secundaria de gastronomía", () => {
  const interpreted = interpretTalentQuery("ventas y gastronomia");
  const ranked = rerankCandidates([
    {
      id: "ventas-principal",
      fullName: "Persona Comercial",
      currentRole: "Ventas",
      tags: ["ventas", "gastronomia"],
      qualityScore: 40,
      documentCount: 1,
      documentSnippet: "Experiencia en ventas y atención en restaurante.",
      score: 0,
      matchReason: ""
    },
    {
      id: "mencion-secundaria",
      fullName: "Persona Legal",
      currentRole: "Abogado",
      tags: ["ventas", "gastronomia"],
      qualityScore: 100,
      documentCount: 1,
      documentSnippet: "Asesoría legal para empresas de ventas y gastronomía.",
      score: 0,
      matchReason: ""
    }
  ], interpreted);

  assert.equal(ranked[0].id, "ventas-principal");
  assert.ok(ranked[0].score > ranked[1].score);
});
