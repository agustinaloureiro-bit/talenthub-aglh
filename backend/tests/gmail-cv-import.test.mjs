import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";

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

test("Gmail no usa asuntos genericos como nombre de candidato", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    "Re: Postulame para futuras vacantes\nventas\nUruguay",
    {
      sourceId: "gmail:false-subject",
      fileName: "Re: Postulame para futuras vacantes",
      fallbackName: "Re: Postulame para futuras vacantes",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>",
      contactText: "Re: Postulame para futuras vacantes\nSeleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.equal(candidate, null);
});

test("Gmail no usa asuntos tecnicos como rol y limpia extensiones del nombre", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    `Yamilla Agustoni PDF
Email yamilla@example.com
Telefono 099 111 333
Experiencia laboral en atencion al cliente.`,
    {
      sourceId: "gmail:postgres-subject",
      fileName: "Yamilla_Agustoni_PDF.pdf",
      currentRole: "postgres",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.ok(candidate);
  assert.equal(candidate.fullName, "Yamilla Agustoni");
  assert.equal(candidate.currentRole, "atencion al cliente");
  assert.ok(!candidate.tags.includes("postgres"));
});

test("Gmail rechaza nombres que son texto extraido o plantillas", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const extracted = candidateFromFreeText(
    "gmail",
    `Extracted
Experiencia en deposito y limpieza.`,
    {
      sourceId: "gmail:extracted",
      fileName: "extracted.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );
  const template = candidateFromFreeText(
    "gmail",
    `profesional creativo morado
Experiencia en ventas.`,
    {
      sourceId: "gmail:template",
      fileName: "profesional_creativo_morado.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.equal(extracted, null);
  assert.equal(template, null);
});

test("Gmail limpia titulos, sufijos y puntuacion del nombre del CV", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const cases = [
    ["Lic Laura Romano.pdf", "Lic Laura Romano\nEmail laura.romano@example.com\nExperiencia juridica.", "Laura Romano"],
    ["Nicolas_Calistro_foto.docx", "Nicolas Calistro foto\nTelefono 099 111 222\nExperiencia en gastronomia.", "Nicolas Calistro"],
    ["Cindy_Bentancourt_!!!!!!_CV.pdf", "Cindy Bentancourt !!!!!!!\nEmail cindy@example.com\nExperiencia en ventas.", "Cindy Bentancourt"],
    ["Audiovisual_Guillermo_de_la_Bandera.pdf", "Audiovisual Guillermo de la Bandera\nEmail guillermo@example.com\nExperiencia audiovisual.", "Guillermo de la Bandera"],
    ["Documento.docx", "Camila Antonella Nieves Sosa C\nFecha de nacimiento 2001\nEmail camila@example.com\nExperiencia laboral en ventas.", "Camila Antonella Nieves Sosa"]
  ];

  for (const [fileName, text, expectedName] of cases) {
    const candidate = candidateFromFreeText("gmail", text, {
      sourceId: `gmail:${fileName}`,
      fileName,
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    });

    assert.ok(candidate, fileName);
    assert.equal(candidate.fullName, expectedName);
  }
});

test("Gmail repara codificacion mojibake y no usa asuntos como rol", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    `CurrÃ­culum Vitae Katherina Ramos
Email katherina@example.com
Experiencia en administraciÃ³n y telemarketing.`,
    {
      sourceId: "gmail:mojibake",
      fileName: "CurrÃ­culum Vitae Katherina Ramos.pdf",
      currentRole: "POSTULACIÓN LABORAL",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.ok(candidate);
  assert.equal(candidate.fullName, "Katherina Ramos");
  assert.equal(candidate.currentRole, "administracion");
  assert.ok(!candidate.tags.includes("POSTULACIÓN LABORAL"));
  assert.ok(!candidate.summary?.includes("POSTULACIÓN LABORAL"));
});

test("Gmail rechaza nombres de archivo con typo de curriculum y una sola palabra", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    "curiculum juanca\nExperiencia como chofer.",
    {
      sourceId: "gmail:curiculum-juanca",
      fileName: "curiculum juanca.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.equal(candidate, null);
});

test("Gmail no corta apellidos con particulas ni acepta plantillas visuales", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const fullName = candidateFromFreeText(
    "gmail",
    "Antonella de Virgiliis\nEmail antonella@example.com\nExperiencia en administracion.",
    {
      sourceId: "gmail:antonella",
      fileName: "Antonella de Virgiliis CV 2025.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );
  const template = candidateFromFreeText(
    "gmail",
    "Curriculum Vitae CV Ingeniero Sencillo Clasico Blanco\nExperiencia en herreria.",
    {
      sourceId: "gmail:visual-template",
      fileName: "Curriculum Vitae CV Ingeniero Sencillo Clasico Blanco.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.ok(fullName);
  assert.equal(fullName.fullName, "Antonella de Virgiliis");
  assert.equal(template, null);
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

test("Gmail repara acentos rotos y extensiones partidas en nombres de archivo", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    "Eliani Brown HernaÌndez p df\nEmail eliani@example.com\nExperiencia en ventas y atencion al cliente.",
    {
      sourceId: "gmail:eliani",
      fileName: "Eliani Brown HernaÌndez p df.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.ok(candidate);
  assert.equal(candidate.fullName, "Eliani Brown Hernández");
});

test("Gmail elimina sufijos tecnicos del export sin cortar el nombre", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    "Yenifer Quintana compressed\nEmail yenifer@example.com\nAbogada con ingles intermedio.",
    {
      sourceId: "gmail:yenifer",
      fileName: "Curriculum Vitae - Yenifer Quintana_compressed.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.ok(candidate);
  assert.equal(candidate.fullName, "Yenifer Quintana");
  assert.equal(candidate.documents[0].fileName, "Curriculum Vitae - Yenifer Quintana.pdf");
});

test("Gmail no convierte plantillas visuales de CV en candidatos", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    "CurriÌculum Vitae CV de Mujer Minimalista Rosa\nAbogada con ingles.",
    {
      sourceId: "gmail:template-woman",
      fileName: "CurriÌculum Vitae CV de Mujer Minimalista Rosa.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.equal(candidate, null);
});

test("Gmail limpia caracteres rotos de PDF en nombres humanos", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    "Mirian Carolina Piedad Rodr� guez\nEmail piedad@example.com\nExperiencia en administracion.",
    {
      sourceId: "gmail:mirian",
      fileName: "Mirian Carolina Piedad Rodr� guez CV.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.ok(candidate);
  assert.equal(candidate.fullName, "Mirian Carolina Piedad Rodriguez");
});

test("Gmail no guarda fechas de archivos como telefonos", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    "Camila Lopez Trazante\nEmail camila@example.com\nTelefono 091406710\nArchivo 20250422_134842_0000\nExperiencia en ventas.",
    {
      sourceId: "gmail:camila",
      fileName: "camila 2025.pdf_20250422_134842_0000.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.ok(candidate);
  assert.deepEqual(candidate.phone, ["091406710"]);
});

test("Gmail no guarda horas ni numeros pegados como telefonos", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    "Sofia Prestes\nEmail sofia@example.com\nArchivo CV_2025-04-30-090327.pdf\nTelefono 096395745\nExperiencia laboral.",
    {
      sourceId: "gmail:date-time-phone",
      fileName: "CV_2025-04-30-090327.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.ok(candidate);
  assert.deepEqual(candidate.phone, ["096395745"]);
});

test("Gmail no mezcla telefonos de referencias laborales como contacto principal", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const candidate = candidateFromFreeText(
    "gmail",
    `Lucia Torres
Email lucia.torres@example.com
Celular 099 222 333
Experiencia en ventas y gastronomia.
Referencias laborales
Maria Rodriguez 092 111 111
Juan Perez 098 222 222`,
    {
      sourceId: "gmail:references",
      fileName: "CV_Lucia_Torres.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.ok(candidate);
  assert.deepEqual(candidate.phone, ["099 222 333"]);
  assert.ok(!candidate.summary?.includes("Maria Rodriguez"));
  assert.ok(!candidate.summary?.includes("092 111 111"));
});

test("Gmail no acepta frases descriptivas o typos de curriculum como nombre", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const descriptive = candidateFromFreeText(
    "gmail",
    "Soy una persona proactiva, organizada y responsable\nEmail persona@example.com\nExperiencia en gastronomia.",
    {
      sourceId: "gmail:soy-una",
      fileName: "Soy una persona proactiva, organizada y responsable.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );
  const typo = candidateFromFreeText(
    "gmail",
    "CORRICULUN Elias Mussa\nEmail elias@example.com\nExperiencia en logistica.",
    {
      sourceId: "gmail:corriculun",
      fileName: "CORRICULUN Elias Mussa.doc",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.equal(descriptive, null);
  assert.ok(typo);
  assert.equal(typo.fullName, "Elias Mussa");
  assert.notEqual(typo.currentRole, "Trabajo/empleo");
});

test("Gmail no acepta titulos de rol o ubicacion como nombre del candidato", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const qa = candidateFromFreeText(
    "gmail",
    "QA Automation\nEmail melania@example.com\nEnglish avanzado. Selenium con Java.",
    {
      sourceId: "gmail:qa-title",
      fileName: "QA_Automation.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );
  const advisor = candidateFromFreeText(
    "gmail",
    "Asesor Financiero\nEmail asesor@example.com\nExperiencia comercial.",
    {
      sourceId: "gmail:advisor-title",
      fileName: "Currículum Vitae Asesor Financiero Profesional Corporativo Azul y Gris.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );
  const location = candidateFromFreeText(
    "gmail",
    "Las Piedras\nEmail persona@example.com\nExperiencia en logistica.",
    {
      sourceId: "gmail:location-title",
      fileName: "CV_2025actual.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.equal(qa, null);
  assert.equal(advisor, null);
  assert.equal(location, null);
});

test("Gmail limpia prefijos externos y numeros de nombres de archivo", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const cases = [
    {
      fileName: "gallito_Laura_Miranda_Zanotta_Bastos_8546.pdf.docx",
      text: "Laura Miranda Zanotta Bastos\nEmail laura@example.com\nExperiencia laboral en gastronomia.",
      expected: "Laura Miranda Zanotta Bastos"
    },
    {
      fileName: "gallito_Luciano_Rebollo_9840 (2).docx",
      text: "Luciano Rebollo\nEmail luciano@example.com\nExperiencia laboral en ventas.",
      expected: "Luciano Rebollo"
    },
    {
      fileName: "c.v florencia barrios.docx",
      text: "Florencia Barrios\nEmail florencia@example.com\nExperiencia laboral en administracion.",
      expected: "Florencia Barrios"
    }
  ];

  for (const item of cases) {
    const candidate = candidateFromFreeText(
      "gmail",
      item.text,
      {
        sourceId: `gmail:${item.fileName}`,
        fileName: item.fileName,
        sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
      }
    );

    assert.ok(candidate);
    assert.equal(candidate.fullName, item.expected);
  }
});

test("Gmail no conserva sufijos de rol ni nombres de plantillas como persona", async () => {
  const { candidateFromFreeText } = await import("../dist/routes/integrations.js");
  const cleanRoleSuffix = candidateFromFreeText(
    "gmail",
    "Camila Morales Ventas\nEmail camila@example.com\nExperiencia laboral en ventas y gastronomia.",
    {
      sourceId: "gmail:role-suffix",
      fileName: "camila morales ventas cv (1).pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );
  const cleanUyPrefix = candidateFromFreeText(
    "gmail",
    "JESUS A FREITES\nEmail jesus@example.com\nExperiencia laboral.",
    {
      sourceId: "gmail:cvuy-prefix",
      fileName: "CV.uy - JESUS A. FREITES P..pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );
  const badTemplate = candidateFromFreeText(
    "gmail",
    "Marketing Gratis\nEmail plantilla@example.com\nCV importado.",
    {
      sourceId: "gmail:template-name",
      fileName: "curriculum marketing gratis femenino rosa.pdf",
      sender: "Seleccion AGLH <seleccion@aglh.com.uy>"
    }
  );

  assert.ok(cleanRoleSuffix);
  assert.equal(cleanRoleSuffix.fullName, "Camila Morales");
  assert.ok(cleanUyPrefix);
  assert.equal(cleanUyPrefix.fullName, "JESUS A FREITES");
  assert.equal(badTemplate, null);
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

test("Gmail Takeout MBOX importa CV adjunto con ventas y gastronomia", async () => {
  const { candidatesFromGmailMbox } = await import("../dist/routes/integrations.js");
  const cvText = `Camila Perez
Email camila.perez@example.com
Telefono 099 333 222
Experiencia en ventas, gastronomia, restaurante y atencion al cliente.`;
  const encoded = Buffer.from(cvText, "utf8").toString("base64").replace(/(.{76})/g, "$1\n");
  const mbox = `From test@example.com Mon Jul 13 10:00:00 2026
From: Camila Perez <camila.perez@example.com>
Subject: CV Camila Perez
Date: Mon, 13 Jul 2026 10:00:00 -0300
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="BOUNDARY"

--BOUNDARY
Content-Type: text/plain; charset="utf-8"

Adjunto CV.
--BOUNDARY
Content-Type: text/plain; name="CV_Camila_Perez.txt"
Content-Disposition: attachment; filename="CV_Camila_Perez.txt"
Content-Transfer-Encoding: base64

${encoded}
--BOUNDARY--
`;

  const result = await candidatesFromGmailMbox(Buffer.from(mbox, "utf8"), "mail.mbox");

  assert.equal(result.stats.messages, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].fullName, "Camila Perez");
  assert.ok(result.rows[0].tags.includes("ventas"));
  assert.ok(result.rows[0].tags.includes("gastronomia"));
  assert.match(result.rows[0].summary ?? "", /gastronomia/i);
});

function zipWithStoredFile(fileName, content) {
  const name = Buffer.from(fileName, "utf8");
  const data = Buffer.from(content, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const centralStart = local.length + name.length + data.length;
  const centralSize = central.length + name.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

function simplePdfWithText(text) {
  const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, " ")}) Tj ET`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${object}\n`;
  }
  const xrefStart = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer << /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

test("Gmail Takeout extrae texto real de PDF adjunto", async () => {
  const { candidatesFromGmailRawMessage } = await import("../dist/routes/integrations.js");
  const pdf = simplePdfWithText("Valeria Gomez ventas gastronomia ingles telefono 099123456");
  const encoded = pdf.toString("base64").replace(/(.{76})/g, "$1\n");
  const message = `From test@example.com Mon Jul 13 10:00:00 2026
From: Valeria Gomez <valeria.gomez@example.com>
Subject: CV Valeria Gomez
Date: Mon, 13 Jul 2026 10:00:00 -0300
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="BOUNDARY"

--BOUNDARY
Content-Type: text/plain; charset="utf-8"

Adjunto CV.
--BOUNDARY
Content-Type: application/pdf; name="CV_Valeria_Gomez.pdf"
Content-Disposition: attachment; filename="CV_Valeria_Gomez.pdf"
Content-Transfer-Encoding: base64

${encoded}
--BOUNDARY--
`;

  const result = await candidatesFromGmailRawMessage(message, "mail.mbox", 1);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].fullName, "Valeria Gomez");
  assert.ok(result.rows[0].documents?.[0]?.rawText?.includes("ventas gastronomia ingles"));
  assert.ok(result.rows[0].tags.includes("ventas"));
  assert.ok(result.rows[0].tags.includes("gastronomia"));
});

test("Gmail Takeout ZIP importa el MBOX interno", async () => {
  const { candidatesFromGmailTakeoutArchive } = await import("../dist/routes/integrations.js");
  const cvText = `Sofia Lopez
Email sofia.lopez@example.com
Telefono 099 111 222
Perfil abogada con ingles avanzado y experiencia corporativa.`;
  const encoded = Buffer.from(cvText, "utf8").toString("base64").replace(/(.{76})/g, "$1\n");
  const mbox = `From test@example.com Mon Jul 13 10:00:00 2026
From: Sofia Lopez <sofia.lopez@example.com>
Subject: CV Sofia Lopez abogada ingles
Date: Mon, 13 Jul 2026 10:00:00 -0300
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="BOUNDARY"

--BOUNDARY
Content-Type: text/plain; charset="utf-8"

Adjunto CV.
--BOUNDARY
Content-Type: text/plain; name="CV_Sofia_Lopez.txt"
Content-Disposition: attachment; filename="CV_Sofia_Lopez.txt"
Content-Transfer-Encoding: base64

${encoded}
--BOUNDARY--
`;
  const zip = zipWithStoredFile("Takeout/Mail/CV.mbox", mbox);
  const result = await candidatesFromGmailTakeoutArchive(zip, "takeout.zip");

  assert.equal(result.stats.mboxFiles, 1);
  assert.equal(result.stats.messages, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].fullName, "Sofia Lopez");
  assert.ok(result.rows[0].tags.includes("abogado"));
  assert.ok(result.rows[0].tags.includes("ingles"));
  assert.match(result.rows[0].summary ?? "", /ingles/i);
});
