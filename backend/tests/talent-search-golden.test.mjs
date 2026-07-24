import assert from "node:assert/strict";
import test from "node:test";

const { interpretTalentQuery } = await import("../dist/intelligence/queryInterpreter.js");
const { rerankCandidates } = await import("../dist/intelligence/candidateRanker.js");

function candidate(id, overrides = {}) {
  return {
    id,
    fullName: "Persona Evaluada",
    currentRole: null,
    city: null,
    country: "Uruguay",
    tags: [],
    email: ["persona.evaluada@example.com"],
    phone: [],
    summary: null,
    qualityScore: 70,
    documentCount: 1,
    documentSnippet: "",
    latestSourceAt: "2026-07-20T12:00:00.000Z",
    score: 0,
    matchReason: "",
    ...overrides
  };
}

const goldenSearches = [
  {
    name: "abogado con ingles exige profesión e idioma",
    query: "Necesito un abogado con inglés",
    candidates: [
      candidate("abogado-ingles", {
        currentRole: "Abogado corporativo",
        tags: ["legal", "ingles"],
        documentSnippet: "Abogado corporativo con inglés avanzado y experiencia contractual."
      }),
      candidate("abogado-sin-ingles", {
        currentRole: "Abogado",
        tags: ["legal"],
        documentSnippet: "Abogado con experiencia en derecho laboral."
      }),
      candidate("ingles-sin-abogado", {
        currentRole: "Administrativa",
        tags: ["ingles"],
        documentSnippet: "Administrativa con inglés avanzado."
      })
    ],
    expected: ["abogado-ingles"]
  },
  {
    name: "administración con facturación excluye perfiles administrativos genéricos",
    query: "Busco auxiliar administrativo con experiencia en facturación",
    candidates: [
      candidate("administracion-facturacion", {
        currentRole: "Auxiliar administrativo",
        tags: ["facturacion"],
        documentSnippet: "Auxiliar administrativo responsable de facturación, archivo y atención a proveedores."
      }),
      candidate("administracion-general", {
        currentRole: "Auxiliar administrativo",
        documentSnippet: "Tareas administrativas generales, recepción y archivo."
      }),
      candidate("facturacion-no-administrativo", {
        currentRole: "Vendedor",
        tags: ["facturacion"],
        documentSnippet: "Venta al público y emisión ocasional de facturas."
      })
    ],
    expected: ["administracion-facturacion"]
  },
  {
    name: "depósito especializado exige autoelevador y picking",
    query: "Necesito auxiliar de depósito con autoelevador y picking",
    candidates: [
      candidate("deposito-completo", {
        currentRole: "Auxiliar de depósito",
        tags: ["autoelevador", "picking"],
        documentSnippet: "Operario de depósito con manejo de autoelevador, picking y preparación de pedidos."
      }),
      candidate("deposito-sin-autoelevador", {
        currentRole: "Auxiliar de depósito",
        tags: ["picking"],
        documentSnippet: "Experiencia en picking, control de stock y preparación de pedidos."
      }),
      candidate("logistica-general", {
        currentRole: "Auxiliar de logística",
        documentSnippet: "Experiencia en distribución y logística."
      })
    ],
    expected: ["deposito-completo"]
  },
  {
    name: "ubicación estricta en Prado descarta residencias incompatibles",
    query: "Busco un operario de fábrica que viva cerca del Prado",
    candidates: [
      candidate("operario-prado", {
        currentRole: "Operario de fábrica",
        city: "Prado",
        documentSnippet: "Operario de producción. Domicilio: Prado, Montevideo."
      }),
      candidate("operario-maldonado", {
        currentRole: "Operario de fábrica",
        city: "Maldonado",
        documentSnippet: "Operario de producción. Domicilio: Maldonado."
      }),
      candidate("administrativo-prado", {
        currentRole: "Administrativo",
        city: "Prado",
        documentSnippet: "Administrativo residente en Prado."
      })
    ],
    expected: ["operario-prado"]
  },
  {
    name: "chofer de ambulancia no acepta conducción no sanitaria",
    query: "Necesito un chofer de ambulancia",
    candidates: [
      candidate("ambulancia", {
        currentRole: "Chofer de ambulancia",
        documentSnippet: "Conductor de ambulancia con experiencia en traslado de pacientes."
      }),
      candidate("reparto", {
        currentRole: "Chofer de reparto",
        documentSnippet: "Chofer de reparto de mercadería y cobranza."
      })
    ],
    expected: ["ambulancia"]
  }
];

for (const golden of goldenSearches) {
  test(`búsqueda dorada: ${golden.name}`, () => {
    const interpreted = interpretTalentQuery(golden.query);
    const ranked = rerankCandidates(golden.candidates, interpreted);
    assert.deepEqual(ranked.map((result) => result.id), golden.expected);
  });
}
