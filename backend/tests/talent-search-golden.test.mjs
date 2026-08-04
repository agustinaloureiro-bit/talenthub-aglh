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
    name: "descripción extensa de apuntador recupera experiencia administrativa de depósito",
    query: `Tareas: Apuntador, verificador de contenedores.
Se requiere experiencia administrativa en depósito.
Las tareas de un apuntador en un puerto implican ser responsable del proceso de carga y descarga de mercancías y contenedores, controlando el pesaje, la documentación y a los peones de descarga.
Horario: 8:00 a 18:00, lunes a viernes y algún sábado.`,
    candidates: [
      candidate("administrativo-deposito", {
        currentRole: "Auxiliar administrativo de depósito",
        tags: ["logistica", "control de stock"],
        documentSnippet: "Control documental de remitos, recepción y despacho de mercadería, inventario y tareas administrativas en depósito."
      }),
      candidate("control-cargas", {
        currentRole: "Verificador de mercadería",
        tags: ["deposito", "logistica"],
        documentSnippet: "Verificación de carga y descarga, pesaje, documentación y control de contenedores en terminal de cargas."
      }),
      candidate("administrativo-general", {
        currentRole: "Auxiliar administrativo",
        documentSnippet: "Recepción, agenda, atención telefónica y archivo de oficina."
      }),
      candidate("deposito-sin-control", {
        currentRole: "Peón de depósito",
        documentSnippet: "Carga y descarga manual de mercadería."
      }),
      candidate("supervisor-logistica", {
        currentRole: "Supervisor/Coordinador de Logística",
        tags: ["logistica", "deposito"],
        documentSnippet: "Supervisión del depósito, control documental, inventario, carga y descarga de mercadería."
      }),
      candidate("director-logistica", {
        currentRole: "Director/Gerente de Logística",
        tags: ["logistica", "deposito"],
        documentSnippet: "Dirección integral de logística, control documental, inventario, carga y descarga de mercadería."
      }),
      candidate("apuntador-secundario", {
        currentRole: "Contabilidad",
        tags: ["administracion", "logistica"],
        documentSnippet: "Experiencia como administrativo logístico y apuntador, controlando documentación, cargas y contenedores."
      })
    ],
    expected: ["control-cargas", "apuntador-secundario", "administrativo-deposito", "supervisor-logistica", "director-logistica"]
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
  },
  {
    name: "mecánica industrial prioriza experiencia en autoelevadores y electromecánica",
    query: `Mecánico Industrial. Reparación y mantenimiento preventivo y correctivo de autoelevadores.
Mantenimiento de equipos industriales. Diagnóstico de fallas mecánicas, hidráulicas y eléctricas.`,
    candidates: [
      candidate("autoelevadores", {
        currentRole: "Mecánico de autoelevadores",
        tags: ["mecanica", "hidraulica", "electricidad"],
        documentSnippet: "Reparación de autoelevadores eléctricos y a combustión, mantenimiento preventivo y diagnóstico hidráulico."
      }),
      candidate("electromecanico", {
        currentRole: "Técnico electromecánico",
        tags: ["mantenimiento industrial"],
        documentSnippet: "Mantenimiento correctivo de maquinaria industrial, motores y sistemas hidráulicos."
      }),
      candidate("automotriz", {
        currentRole: "Mecánico automotriz",
        documentSnippet: "Reparación y service de automóviles particulares."
      }),
      candidate("electricista", {
        currentRole: "Electricista domiciliario",
        documentSnippet: "Instalaciones eléctricas residenciales."
      })
    ],
    expected: ["autoelevadores", "electromecanico"]
  }
];

for (const golden of goldenSearches) {
  test(`búsqueda dorada: ${golden.name}`, () => {
    const interpreted = interpretTalentQuery(golden.query);
    const ranked = rerankCandidates(golden.candidates, interpreted);
    assert.deepEqual(ranked.map((result) => result.id), golden.expected);
  });
}
