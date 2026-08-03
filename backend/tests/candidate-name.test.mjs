import test from "node:test";
import assert from "node:assert/strict";

test("el nombre canonico no se degrada con una fuente de baja confianza", async () => {
  const { chooseCanonicalCandidateName } = await import("../dist/services/candidateName.js");
  assert.equal(chooseCanonicalCandidateName("Lucia Fernandez Pereira", "Maria Garcia", 65), "Lucia Fernandez Pereira");
});

test("el nombre canonico no reemplaza identidades distintas solo por confianza", async () => {
  const { chooseCanonicalCandidateName } = await import("../dist/services/candidateName.js");
  assert.equal(chooseCanonicalCandidateName("Maria Garcia", "Lucia Fernandez Pereira", 100), "Maria Garcia");
});

test("el nombre canonico conserva la variante mas completa de la misma persona", async () => {
  const { chooseCanonicalCandidateName } = await import("../dist/services/candidateName.js");
  assert.equal(chooseCanonicalCandidateName("Lucia Fernandez", "Lucia Fernandez Pereira", 70), "Lucia Fernandez Pereira");
});

test("solo corrige un nombre distinto cuando el correo respalda exclusivamente la evidencia del CV", async () => {
  const { shouldReplaceCandidateName } = await import("../dist/services/candidateName.js");
  const valid = (value) => value.trim().split(/\s+/).length >= 2;
  const evidence = { value: "Lucia Fernandez Pereira", source: "cv_label", confidence: 100 };
  assert.equal(shouldReplaceCandidateName("Maria Garcia", evidence, ["lucia.fernandez@example.com"], valid), true);
  assert.equal(shouldReplaceCandidateName("Maria Garcia", evidence, ["maria.garcia@example.com"], valid), false);
});

test("limpia etiquetas sin dos puntos y nombres repetidos en el encabezado", async () => {
  const { extractCandidateNameEvidence } = await import("../dist/services/candidateName.js");
  const clean = (value) => value.trim();
  const valid = (value) => value.trim().split(/\s+/).length >= 2;
  assert.equal(extractCandidateNameEvidence("Nombre Juan Andres Pratt Ramirez\nContacto", clean, valid)?.value, "Juan Andres Pratt Ramirez");
  assert.equal(extractCandidateNameEvidence("Adrian Alejandro Romero Adrian Alejandro Romero\nContacto", clean, valid)?.value, "Adrian Alejandro Romero");
});
