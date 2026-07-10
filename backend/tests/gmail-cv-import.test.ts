import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret";
process.env.ADMIN_EMAIL ??= "admin@example.com";
process.env.ADMIN_PASSWORD ??= "password";

test("Gmail no crea candidatos desde correos administrativos sin nombre real", async () => {
  const { candidateFromFreeText } = await import("../src/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    "The Google Cloud Team\nYour request for work account access on your Mac is pending\nSecurity alert",
    {
      sourceId: "gmail:false-system",
      fileName: "Your request for work account access",
      fallbackName: "The Google Cloud Team"
    }
  );

  assert.equal(candidate, null);
});

test("Gmail crea candidato desde CV con nombre humano y evidencia laboral", async () => {
  const { candidateFromFreeText } = await import("../src/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    `Matias Coppola Martinez
Fecha de nacimiento 01/01/1990
Montevideo
Email matias.coppola@example.com
Telefono 099 123 456
Experiencia en logistica y produccion.
Ingles intermedio.`,
    {
      sourceId: "gmail:cv-real",
      fileName: "CV_Matias_Coppola_Actualizado.docx"
    }
  );

  assert.ok(candidate);
  assert.equal(candidate.fullName, "Matias Coppola");
  assert.equal(candidate.documents?.[0]?.fileName, "CV_Matias_Coppola_Actualizado.docx");
  assert.ok(candidate.documents?.[0]?.rawText?.includes("Experiencia en logistica"));
});
