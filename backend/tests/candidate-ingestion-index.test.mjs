import assert from "node:assert/strict";
import test from "node:test";

const { candidateContentHash } = await import("../dist/services/candidateIngestion.js");

function candidate(overrides = {}) {
  return {
    fullName: "Ana Pereira",
    email: ["ana@example.com"],
    phone: ["099123456"],
    city: "Montevideo",
    country: "Uruguay",
    currentRole: "Auxiliar administrativa",
    tags: ["administracion", "facturacion"],
    languages: [{ lang: "ingles", level: "intermedio" }],
    summary: "Experiencia administrativa y en facturacion.",
    qualityScore: 80,
    sourceId: "gmail-message-1",
    sourceUrl: "https://mail.google.com/mail/u/0/#inbox/1",
    documents: [{
      type: "cv",
      fileName: "CV Ana Pereira.pdf",
      mimeType: "application/pdf",
      rawText: "Ana Pereira. Auxiliar administrativa. Facturacion.",
      isPrimaryCv: true
    }],
    raw: { volatileAgentRun: "ignored" },
    ...overrides
  };
}

test("la huella de importacion es estable aunque cambie el orden de tags y contactos", () => {
  const original = candidate();
  const reordered = candidate({
    email: [...original.email].reverse(),
    phone: [...original.phone].reverse(),
    tags: [...original.tags].reverse(),
    raw: { anotherTransientValue: true }
  });

  assert.equal(candidateContentHash(original), candidateContentHash(reordered));
});

test("la huella cambia cuando cambia el contenido util del CV", () => {
  const original = candidate();
  const changed = candidate({
    documents: [{
      ...original.documents[0],
      rawText: `${original.documents[0].rawText} Manejo avanzado de SAP.`
    }]
  });

  assert.notEqual(candidateContentHash(original), candidateContentHash(changed));
});

test("la huella cambia cuando cambia un dato estructurado buscable", () => {
  assert.notEqual(
    candidateContentHash(candidate()),
    candidateContentHash(candidate({ city: "Ciudad de la Costa" }))
  );
});
