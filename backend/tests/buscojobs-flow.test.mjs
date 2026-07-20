import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret";
process.env.ADMIN_EMAIL ??= "admin@example.com";
process.env.ADMIN_PASSWORD ??= "password";

test("usa la ruta oficial de postulaciones por etapa", async () => {
  const { buscojobsApplicantEndpoint } = await import("../dist/routes/integrations.js");
  const url = new URL(buscojobsApplicantEndpoint("274000", "81", 25, 50));
  const filter = JSON.parse(url.searchParams.get("filter"));

  assert.equal(url.pathname, "/v3/uy/api/ofertas/274000/etapas/81/postulaciones");
  assert.deepEqual(filter, { order: ["FechaPostulacion DESC"], limit: 25, skip: 50 });
});

test("obtiene todas las etapas configuradas en una oferta", async () => {
  const { buscojobsStageIdsFromOffer } = await import("../dist/routes/integrations.js");
  const ids = buscojobsStageIdsFromOffer({
    Procesos: [{ Etapas: [{ IdEtapaPostulacion: 10 }, { IdEtapaPostulacion: 11 }] }]
  });

  assert.deepEqual(ids, ["10", "11"]);
});

test("construye un candidato real desde la ficha oficial y no desde la oferta", async () => {
  const { applicantFromRow } = await import("../dist/routes/integrations.js");
  const candidate = applicantFromRow({
    IdPostulacion: 41318561,
    Postulante: {
      IdPostulante: 100,
      PrimerNombre: "Valeria",
      PrimerApellido: "Pereira",
      Ciudad: { Nombre: "Montevideo" }
    },
    CvTexto: "Valeria Pereira. Abogada con experiencia en derecho laboral. Ingles avanzado. valeria@example.com",
    CVUrl: "https://api.buscojobs.com/cv.pdf",
    FileName: "Valeria Pereira.pdf"
  }, {
    IdOferta: 274000,
    CargoVacante: "Abogado laboral"
  });

  assert.ok(candidate);
  assert.equal(candidate.fullName, "Valeria Pereira");
  assert.equal(candidate.sourceId, "buscojobs:41318561");
  assert.equal(candidate.city, "Montevideo");
  assert.deepEqual(candidate.email, ["valeria@example.com"]);
  assert.equal(candidate.documents[0].type, "cv");
});

test("conserva token y decodifica SessionId aunque haya cookies guardadas", async () => {
  const { buscojobsAuthFromConfig } = await import("../dist/services/buscojobsClient.js");
  const auth = buscojobsAuthFromConfig({
    apiKey: "Bearer header.payload.signature",
    sessionCookies: "token=old; ASP.NET_SessionId=abc%2B123",
    empresaId: "119341"
  });

  assert.equal(auth.authorization, "header.payload.signature");
  assert.equal(auth.sessionId, "abc+123");
  assert.equal(auth.empresaId, "119341");
});
