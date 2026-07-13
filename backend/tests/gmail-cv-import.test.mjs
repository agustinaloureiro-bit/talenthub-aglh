import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret";
process.env.ADMIN_EMAIL ??= "admin@example.com";
process.env.ADMIN_PASSWORD ??= "password";

test("Gmail no crea candidatos desde correos administrativos sin nombre real", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    "The Google Cloud Team\nYour request for work account access on your Mac is pending\nSecurity alert",
    {
      sourceId: "gmail:false-system",
      fileName: "Your request for work account access",
      fallbackName: "The Google Cloud Team",
      sender: "The Google Cloud Team <googlecloud-noreply@google.com>"
    }
  );

  assert.equal(candidate, null);
});

test("Gmail crea candidato desde CV con nombre humano y evidencia laboral", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
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

test("Gmail importa CV adjunto aunque el texto extraido no incluya nombre, usando remitente humano", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    `cv.pdf
Experiencia en administracion, atencion al cliente y ventas.
Ingles avanzado.
Disponibilidad horaria.`,
    {
      sourceId: "gmail:message-1:attachment-1",
      fileName: "cv.pdf",
      currentRole: "Postulacion a administrativa",
      sender: "Laura Fernandez <laura.fernandez@example.com>"
    }
  );

  assert.ok(candidate);
  assert.equal(candidate.fullName, "Laura Fernandez");
  assert.deepEqual(candidate.email, ["laura.fernandez@example.com"]);
  assert.equal(candidate.documents?.[0]?.sourceId, "gmail:message-1:attachment-1");
  assert.ok(candidate.documents?.[0]?.rawText?.includes("Ingles avanzado"));
});

test("Gmail no crea candidato usando la casilla de seleccion como persona", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    "Curriculum vitae.pdf",
    {
      sourceId: "gmail:selection-mailbox",
      fileName: "Curriculum vitae.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>",
      contactText: "Curriculum vitae.pdf\nSeleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.equal(candidate, null);
});

test("Gmail limpia PDF ilegible y no lo guarda como resumen del candidato", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    "CV_Sofia_Silva.pdf\n%PDF-1.4 endobj xref startxref /FlateDecode /XObject /Font stream abc",
    {
      sourceId: "gmail:pdf-binary",
      fileName: "CV_Sofia_Silva.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>",
      contactText: "CV_Sofia_Silva.pdf"
    }
  );

  assert.ok(candidate);
  assert.equal(candidate.fullName, "Sofia Silva");
  assert.ok(!candidate.summary?.includes("%PDF"));
  assert.ok(!candidate.documents?.[0]?.rawText?.includes("%PDF"));
});

test("Gmail no mezcla contactos ajenos del cuerpo del correo con el CV", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    "CV_Sofia_Silva.pdf\nSofia Silva\nmariasofiasilva100@gmail.com\n099 111 222",
    {
      sourceId: "gmail:isolated-attachment",
      fileName: "CV_Sofia_Silva.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>",
      contactText: "CV_Sofia_Silva.pdf\nSofia Silva\nmariasofiasilva100@gmail.com\n099 111 222\nSeleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.ok(candidate);
  assert.deepEqual(candidate.email, ["mariasofiasilva100@gmail.com"]);
  assert.deepEqual(candidate.phone, ["099 111 222"]);
});

test("Gmail resume el perfil del CV con datos utiles sin inventar", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    `Valeria Gomez
Montevideo
Email valeria.gomez@example.com
Telefono 099 555 777
Abogada egresada de Facultad de Derecho.
Experiencia laboral: 4 anos en contratos, derecho corporativo y asesoramiento juridico.
Ingles avanzado.`,
    {
      sourceId: "gmail:legal-cv",
      fileName: "CV_Valeria_Gomez.pdf"
    }
  );

  assert.ok(candidate);
  assert.equal(candidate.currentRole, "abogado");
  assert.equal(candidate.years, 4);
  assert.match(candidate.summary, /Perfil detectado: abogado/i);
  assert.match(candidate.summary, /Experiencia/i);
  assert.match(candidate.summary, /Idiomas: ingles/i);
  assert.ok(!candidate.summary?.includes("%PDF"));
});

test("Gmail usa modo incremental cuando el historico ya termino", async () => {
  const { gmailSyncQueryForConfig } = await import("../dist/routes/integrations.js");
  const result = gmailSyncQueryForConfig({ gmailBackfillCompleteAt: "2026-07-13T12:00:00.000Z" }, false);

  assert.equal(result.mode, "incremental");
  assert.match(result.query, /after:2026\/07\/12/);
});

test("Gmail mantiene modo historico si todavia queda cola pendiente", async () => {
  const { gmailSyncQueryForConfig } = await import("../dist/routes/integrations.js");
  const result = gmailSyncQueryForConfig({ gmailBackfillCompleteAt: "2026-07-13T12:00:00.000Z" }, true);

  assert.equal(result.mode, "historical");
  assert.ok(!result.query.includes("after:"));
});

test("Gmail respeta busqueda personalizada si fue configurada", async () => {
  const { gmailSyncQueryForConfig } = await import("../dist/routes/integrations.js");
  const result = gmailSyncQueryForConfig({ query: "from:seleccion@aglh.com.uy has:attachment" }, false);

  assert.equal(result.mode, "custom");
  assert.equal(result.query, "from:seleccion@aglh.com.uy has:attachment");
});
