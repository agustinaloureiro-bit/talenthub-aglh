import assert from "node:assert/strict";
import test from "node:test";

const { interpretTalentQuery } = await import("../dist/intelligence/queryInterpreter.js");
const { isCredibleCandidateName, rerankCandidates } = await import("../dist/intelligence/candidateRanker.js");
const { RecruitmentIntelligenceEngine } = await import("../dist/intelligence/intelligenceEngine.js");
const { downloadContentDisposition } = await import("../dist/routes/candidates.js");
const { evaluateUruguayProximity, nearbyUruguayLocations } = await import("../dist/intelligence/uruguayGeography.js");

test("interpreta abogado con ingles como rol e idioma", () => {
  const interpreted = interpretTalentQuery("Necesito un abogado con inglés.");

  assert.ok(interpreted.roles.includes("abogado"));
  assert.ok(interpreted.languages.includes("ingles"));
  assert.ok(interpreted.mustHave.includes("abogado"));
  assert.ok(interpreted.mustHave.includes("ingles"));
});

test("interpreta auxiliar administrativo con facturacion sin palabras de relleno", async () => {
  const interpreted = interpretTalentQuery("Busco un auxiliar administrativo con experiencia en facturación");
  assert.deepEqual(interpreted.roles, ["auxiliar administrativo"]);
  assert.ok(interpreted.skills.includes("facturación"));

  let providerQuery = "";
  const engine = new RecruitmentIntelligenceEngine(async (query) => {
    providerQuery = query;
    return [];
  });
  await engine.search("Busco un auxiliar administrativo con experiencia en facturación");

  assert.match(providerQuery, /auxiliar administrativo/);
  assert.match(providerQuery, /facturaci[oó]n/);
  assert.doesNotMatch(providerQuery, /\bbusco\b|\bexperiencia\b/);
});

test("interpreta chofer de ambulancia como un rol especializado con requisitos obligatorios", () => {
  const interpreted = interpretTalentQuery("Necesito un chofer de ambulancia");

  assert.deepEqual(interpreted.roles, ["chofer de ambulancia"]);
  assert.equal(interpreted.requiredGroups.length, 2);
});

test("chofer de ambulancia excluye operarios y conductores sin experiencia sanitaria", () => {
  const interpreted = interpretTalentQuery("Necesito un chofer de ambulancia");
  const ranked = rerankCandidates([
    {
      id: "ambulancia",
      fullName: "Carlos Ejemplo",
      currentRole: "Conductor de ambulancia",
      tags: ["emergencia movil", "traslado de pacientes"],
      qualityScore: 60,
      documentCount: 1,
      documentSnippet: "Chofer de ambulancia con experiencia en traslado de pacientes.",
      score: 0,
      matchReason: ""
    },
    {
      id: "fabrica",
      fullName: "Pedro Ejemplo",
      currentRole: "Operario de fabrica",
      tags: ["produccion"],
      qualityScore: 100,
      documentCount: 1,
      documentSnippet: "Operario de fabrica y manejo de maquinaria.",
      score: 0,
      matchReason: ""
    },
    {
      id: "reparto",
      fullName: "Mario Ejemplo",
      currentRole: "Chofer de reparto",
      tags: ["logistica"],
      qualityScore: 90,
      documentCount: 1,
      documentSnippet: "Conductor de reparto y entrega de mercaderia.",
      score: 0,
      matchReason: ""
    },
    {
      id: "menciones-dispersas",
      fullName: "Gaston Ejemplo",
      currentRole: "Gastronomia",
      tags: ["chofer", "salud"],
      qualityScore: 95,
      documentCount: 1,
      documentSnippet: `Chofer de reparto y tareas de cocina. ${"experiencia general ".repeat(12)} Colaboracion ocasional con una emergencia medica.`,
      score: 0,
      matchReason: ""
    }
  ], interpreted);

  assert.deepEqual(ranked.map((candidate) => candidate.id), ["ambulancia"]);
  assert.ok(ranked[0].score >= 95);
});

test("acepta experiencia explicita en transporte de pacientes aunque el rol figure como chofer", () => {
  const interpreted = interpretTalentQuery("Necesito un chofer de ambulancia");
  const ranked = rerankCandidates([{
    id: "transporte-pacientes",
    fullName: "Mario Paciente",
    currentRole: "Chofer",
    tags: ["chofer", "salud"],
    qualityScore: 70,
    documentCount: 1,
    documentSnippet: "Chofer con curso de preparacion enfocado al transporte de pacientes y apoyo al personal asistencial.",
    score: 0,
    matchReason: ""
  }], interpreted);

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, "transporte-pacientes");
});

test("interpreta una necesidad conceptual aunque no nombre la competencia", () => {
  const interpreted = interpretTalentQuery("Busco una persona organizada para coordinar un equipo y tratar con clientes");

  assert.ok(interpreted.skills.includes("organizacion"));
  assert.ok(interpreted.skills.includes("liderazgo"));
  assert.ok(interpreted.skills.includes("comunicacion"));
});

test("interpreta barrio y sistemas como criterios buscables", () => {
  const interpreted = interpretTalentQuery("Busco administrativa de Pocitos con manejo de SAP y Memory");

  assert.ok(interpreted.roles.includes("administrativa"));
  assert.ok(interpreted.locations.includes("pocitos"));
  assert.ok(interpreted.skills.includes("sap"));
  assert.ok(interpreted.skills.includes("memory"));
  assert.ok(interpreted.mustHave.includes("pocitos"));
});

test("interpreta supermercado sin experiencia como perfil operativo y expande Ciudad de la Costa", () => {
  const interpreted = interpretTalentQuery("Estoy buscando hombres para trabajar en un supermercado. No necesitan tener experiencia específica. Deben ser de Ciudad de la Costa o alrededores.");

  assert.ok(interpreted.industries.includes("supermercado"));
  assert.ok(interpreted.locations.includes("ciudad de la costa"));
  assert.equal(interpreted.profileLevel, "basic");
  assert.ok(interpreted.locationGroups[0].includes("solymar"));
  assert.ok(interpreted.locationGroups[0].includes("lagomar"));
  assert.ok(!interpreted.locationGroups[0].includes("canelones"));
  assert.deepEqual(interpreted.ignoredCriteria, ["genero"]);
});

test("calcula cercania geografica real para localidades uruguayas", () => {
  const solymar = evaluateUruguayProximity("Solymar", "Ciudad de la Costa");
  const canelones = evaluateUruguayProximity("Canelones", "Ciudad de la Costa");
  const maldonado = evaluateUruguayProximity("Maldonado", "Ciudad de la Costa");
  const nearby = nearbyUruguayLocations("Ciudad de la Costa");

  assert.equal(solymar?.matches, true);
  assert.ok((solymar?.distanceKm ?? 99) < 5);
  assert.equal(canelones?.matches, false);
  assert.equal(maldonado?.matches, false);
  assert.ok(nearby.includes("Lagomar"));
  assert.ok(!nearby.includes("Canelones"));
  assert.ok(!nearby.includes("Maldonado"));
});

test("un puesto basico en Ciudad de la Costa incluye perfiles operativos cercanos y excluye ubicaciones o profesiones incompatibles", () => {
  const interpreted = interpretTalentQuery("Estoy buscando hombres para trabajar en un supermercado, no necesitan experiencia específica, de Ciudad de la Costa o alrededores");
  const ranked = rerankCandidates([
    {
      id: "solymar",
      fullName: "Camila Operativa",
      currentRole: "Auxiliar de depósito",
      city: "Solymar",
      tags: ["stock", "logistica"],
      qualityScore: 60,
      documentCount: 1,
      documentSnippet: "Experiencia operativa, reposición y atención al cliente.",
      score: 0,
      matchReason: ""
    },
    {
      id: "lagomar",
      fullName: "Pablo Operativo",
      currentRole: "Operario de producción",
      city: "Lagomar",
      tags: ["produccion"],
      qualityScore: 55,
      documentCount: 1,
      documentSnippet: "Tareas generales y trabajo en equipo.",
      score: 0,
      matchReason: ""
    },
    {
      id: "pocitos",
      fullName: "Martin Repositor",
      currentRole: "Repositor",
      city: "Pocitos",
      tags: ["stock"],
      qualityScore: 90,
      documentCount: 1,
      documentSnippet: "Reposición de mercadería.",
      score: 0,
      matchReason: ""
    },
    {
      id: "contador",
      fullName: "Andres Profesional",
      currentRole: "Contador público",
      city: "Ciudad de la Costa",
      tags: ["contabilidad"],
      qualityScore: 95,
      documentCount: 1,
      documentSnippet: "Contador público recibido, experiencia en auditoría, finanzas, ventas y atención al cliente.",
      score: 0,
      matchReason: ""
    },
    {
      id: "montevideo-menciona-canelones",
      fullName: "Lucia Referencia",
      currentRole: "Cajera",
      city: "Montevideo",
      tags: ["caja"],
      qualityScore: 80,
      documentCount: 1,
      documentSnippet: "Experiencia como cajera en una empresa con sucursal en Canelones.",
      score: 0,
      matchReason: ""
    },
    {
      id: "maldonado-mal-guardado",
      fullName: "Ignacio Ubicacion",
      currentRole: "Atención al cliente",
      city: "Canelones",
      tags: ["supermercado"],
      qualityScore: 90,
      documentCount: 1,
      documentSnippet: "Datos Personales Batalla del Cerrito 985, Maldonado, Maldonado, Uruguay Web & Redes Experiencia laboral en supermercado. Estudios Básicos Escuela 236, Toledo, Canelones, Uruguay.",
      score: 0,
      matchReason: ""
    }
  ], interpreted);

  assert.deepEqual(ranked.map((candidate) => candidate.id), ["solymar", "lagomar"]);
  assert.match(ranked[0].matchReason, /ubicación solicitada \(a \d+(?:\.\d+)? km\)/i);
});

test("no usa el genero solicitado para recuperar ni ordenar candidatos", async () => {
  let providerQuery = "";
  const engine = new RecruitmentIntelligenceEngine(async (query) => {
    providerQuery = query;
    return [];
  });

  await engine.search("Busco hombres para supermercado en Ciudad de la Costa sin experiencia");

  assert.doesNotMatch(providerQuery, /hombre|mujer|genero/i);
  assert.match(providerQuery, /supermercado/i);
  assert.match(providerQuery, /ciudad de la costa/i);
});

test("prioriza ubicación y sistema cuando se piden en lenguaje natural", () => {
  const interpreted = interpretTalentQuery("administrativa en Pocitos con SAP");
  const ranked = rerankCandidates([
    {
      id: "pocitos-sap",
      fullName: "Ana Pereira",
      currentRole: "Administrativa",
      city: "Pocitos",
      tags: ["sap", "administracion"],
      qualityScore: 50,
      documentCount: 1,
      documentSnippet: "Administrativa con manejo de SAP.",
      score: 0,
      matchReason: ""
    },
    {
      id: "sin-ubicacion",
      fullName: "Maria Rodriguez",
      currentRole: "Administrativa",
      city: "Salto",
      tags: ["administracion"],
      qualityScore: 90,
      documentCount: 1,
      documentSnippet: "Experiencia administrativa general.",
      score: 0,
      matchReason: ""
    }
  ], interpreted);

  assert.equal(ranked[0].id, "pocitos-sap");
  assert.match(ranked[0].matchReason, /ubicación solicitada/i);
});

test("operario de fabrica cerca del Prado recupera equivalentes y no oculta Montevideo sin barrio", () => {
  const interpreted = interpretTalentQuery("Busco un operario para fábrica, tiene que vivir cerca del Prado y tener experiencia en fábrica.");
  const ranked = rerankCandidates([
    {
      id: "prado",
      fullName: "Carlos Produccion",
      currentRole: "Auxiliar de producción",
      city: "Prado",
      tags: ["produccion", "manufactura"],
      qualityScore: 65,
      documentCount: 1,
      documentSnippet: "Experiencia en fábrica y línea de producción. Domicilio: Prado, Montevideo.",
      score: 0,
      matchReason: ""
    },
    {
      id: "montevideo",
      fullName: "Mario Operador",
      currentRole: "Operador de maquinaria",
      city: "Montevideo",
      tags: ["planta industrial"],
      qualityScore: 70,
      documentCount: 1,
      documentSnippet: "Operador de maquinaria con experiencia en planta industrial. Montevideo.",
      score: 0,
      matchReason: ""
    },
    {
      id: "sin-ubicacion",
      fullName: "Pedro Manufactura",
      currentRole: "Operario de producción",
      tags: ["manufactura"],
      qualityScore: 60,
      documentCount: 1,
      documentSnippet: "Experiencia en fábrica, producción y tareas de planta.",
      score: 0,
      matchReason: ""
    },
    {
      id: "experiencia-previa",
      fullName: "Martin Experiencia",
      currentRole: "Vendedor",
      city: "Prado",
      tags: ["ventas"],
      qualityScore: 75,
      documentCount: 1,
      documentSnippet: "Actualmente vendedor. Anteriormente operario de línea de producción y manejo de maquinaria en fábrica.",
      score: 0,
      matchReason: ""
    },
    {
      id: "maldonado",
      fullName: "Luis Distante",
      currentRole: "Operario",
      city: "Maldonado",
      tags: ["fabrica"],
      qualityScore: 90,
      documentCount: 1,
      documentSnippet: "Operario de fábrica. Domicilio: Maldonado, Uruguay.",
      score: 0,
      matchReason: ""
    },
    {
      id: "administrativo",
      fullName: "Andres Oficina",
      currentRole: "Administrativo",
      city: "Prado",
      tags: ["administracion", "fabrica"],
      qualityScore: 100,
      documentCount: 1,
      documentSnippet: "Tareas administrativas en una fábrica.",
      score: 0,
      matchReason: ""
    }
  ], interpreted);

  assert.deepEqual(ranked.map((candidate) => candidate.id), ["prado", "montevideo", "sin-ubicacion", "experiencia-previa"]);
  assert.match(ranked[0].matchReason, /ubicación solicitada/i);
  assert.match(ranked[1].matchReason, /barrio no está declarado/i);
  assert.match(ranked[2].matchReason, /ubicación pendiente de verificar/i);
  assert.ok(ranked[0].score > ranked[1].score);
  assert.ok(ranked[1].score > ranked[2].score);
  assert.ok(ranked[3].score < 70);
  assert.match(ranked[3].matchReason, /no como perfil principal/i);
});

test("amplia la consulta conceptual antes de buscar en todos los CV", async () => {
  let providerQuery = "";
  const engine = new RecruitmentIntelligenceEngine(async (query) => {
    providerQuery = query;
    return [];
  });

  await engine.search("Busco una persona organizada para coordinar un equipo");

  assert.match(providerQuery, /organizacion/);
  assert.match(providerQuery, /liderazgo/);
});

test("no corta el ranking en veinte candidatos", async () => {
  const candidates = Array.from({ length: 65 }, (_, index) => ({
    id: `candidate-${index}`,
    fullName: `Persona Ejemplo${String.fromCharCode(65 + (index % 26))}`,
    currentRole: "Ventas",
    tags: ["ventas"],
    qualityScore: 50,
    documentCount: 1,
    documentSnippet: "Experiencia comprobable en ventas.",
    score: 0,
    matchReason: ""
  }));
  const engine = new RecruitmentIntelligenceEngine(async () => candidates);
  const result = await engine.search("ventas", { activeOnly: true });

  assert.equal(result.data.length, 65);
});

test("aplica filtros operativos y un minimo de compatibilidad", async () => {
  let receivedFilters = null;
  const engine = new RecruitmentIntelligenceEngine(async (_query, filters) => {
    receivedFilters = filters;
    return [
      {
        id: "fuerte",
        fullName: "Laura Administrativa",
        currentRole: "Auxiliar administrativo",
        tags: ["facturacion"],
        qualityScore: 50,
        documentCount: 1,
        documentSnippet: "Auxiliar administrativo con experiencia en facturacion.",
        score: 0,
        matchReason: ""
      },
      {
        id: "debil",
        fullName: "Mario General",
        currentRole: "Administrativo",
        tags: [],
        qualityScore: 50,
        documentCount: 1,
        documentSnippet: "Tareas generales de oficina.",
        score: 0,
        matchReason: ""
      }
    ];
  });

  const filters = { source: ["gmail"], location: "Montevideo", contact: "both", minScore: 80, activeOnly: true };
  const result = await engine.search("auxiliar administrativo con facturacion", filters);

  assert.deepEqual(receivedFilters, filters);
  assert.deepEqual(result.data.map((candidate) => candidate.id), ["fuerte"]);
});

test("excluye frases del CV usadas por error como nombre", () => {
  assert.equal(isCredibleCandidateName("la preparación y entrega de órdenes"), false);
  assert.equal(isCredibleCandidateName("Sin Título"), false);
  assert.equal(isCredibleCandidateName("Gimena Gonzalez"), true);
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
  assert.equal(ranked.length, 1);
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
  assert.ok(ranked[1].score < 70);
  assert.match(ranked[1].matchReason, /no como perfil principal/i);
});

test("el filtro de 70 por ciento excluye roles mencionados solo de forma secundaria", async () => {
  const engine = new RecruitmentIntelligenceEngine(async () => [{
    id: "mencion-secundaria",
    fullName: "Valeria Legal",
    currentRole: "Abogada",
    tags: ["administracion", "facturacion"],
    email: ["valeria@example.com"],
    qualityScore: 100,
    documentCount: 1,
    documentSnippet: "Asesoría legal para clientes del área administrativa y de facturación.",
    score: 0,
    matchReason: ""
  }]);

  const result = await engine.search("auxiliar administrativo con facturacion", { minScore: 70 });

  assert.deepEqual(result.data, []);
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

test("entre perfiles igual de compatibles prioriza el CV recibido recientemente", () => {
  const interpreted = interpretTalentQuery("ingeniero de software");
  const base = {
    currentRole: "Ingeniero de software",
    tags: ["ingenieria", "software"],
    qualityScore: 80,
    documentCount: 1,
    documentSnippet: "Ingeniero de software con experiencia en desarrollo.",
    score: 0,
    matchReason: ""
  };
  const ranked = rerankCandidates([
    { ...base, id: "antiguo", fullName: "Carlos Antiguo", latestSourceAt: "2022-01-01T00:00:00Z" },
    { ...base, id: "reciente", fullName: "Lucía Reciente", latestSourceAt: new Date().toISOString() }
  ], interpreted);

  assert.equal(ranked[0].id, "reciente");
  assert.ok(ranked[0].score > ranked[1].score);
});

test("permite ordenar los resultados compatibles por fecha del CV", async () => {
  const engine = new RecruitmentIntelligenceEngine(async () => [
    { id: "mejor", fullName: "Ana Ingeniería", currentRole: "Ingeniera", tags: ["ingenieria"], qualityScore: 90, documentCount: 1, documentSnippet: "Ingeniera con amplia experiencia.", latestSourceAt: "2024-01-01T00:00:00Z", score: 0, matchReason: "" },
    { id: "nuevo", fullName: "Luis Ingeniería", currentRole: "Ingeniero", tags: ["ingenieria"], qualityScore: 60, documentCount: 1, documentSnippet: "Ingeniero junior.", latestSourceAt: "2026-07-20T00:00:00Z", score: 0, matchReason: "" }
  ]);

  const result = await engine.search("ingeniero", { sort: "recent" });
  assert.equal(result.data[0].id, "nuevo");
});
