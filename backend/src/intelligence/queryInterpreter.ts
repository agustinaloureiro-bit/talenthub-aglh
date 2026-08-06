import type { InterpretedTalentQuery } from "./types.js";
import { knownUruguayLocationNames, nearbyUruguayLocations } from "./uruguayGeography.js";

const LANGUAGE_PATTERNS: Array<[RegExp, string]> = [
  [/ingles|ingl[eé]s|english/i, "ingles"],
  [/portugues|portugu[eé]s/i, "portugues"],
  [/frances|franc[eé]s/i, "frances"],
  [/italiano/i, "italiano"]
];

const SENIORITY_PATTERNS: Array<[RegExp, string]> = [
  [/\b(junior|jr)\b/i, "Junior"],
  [/semi\s*senior|ssr/i, "Semi-Senior"],
  [/\b(senior|sr)\b/i, "Senior"],
  [/lead|lider|líder|jefe|manager|gerente/i, "Lead"]
];

const ROLE_HINTS = [
  "mecanico industrial",
  "mecánico industrial",
  "tecnico electromecanico",
  "técnico electromecánico",
  "electromecanico",
  "electromecánico",
  "tecnico de mantenimiento industrial",
  "técnico de mantenimiento industrial",
  "maquinista de refrigeracion",
  "maquinista de refrigeración",
  "tecnico en refrigeracion",
  "técnico en refrigeración",
  "tecnico frigorista",
  "técnico frigorista",
  "frigorista",
  "chofer de ambulancia",
  "conductor de ambulancia",
  "ambulanciero",
  "chofer",
  "conductor",
  "abogado",
  "abogada",
  "legal",
  "asesor legal",
  "asesora legal",
  "ingeniero industrial",
  "ingeniero",
  "analista",
  "auxiliar administrativo",
  "administrativo",
  "administrativa",
  "vendedor de terreno",
  "vendedora de terreno",
  "venta de terreno",
  "ventas de terreno",
  "vendedor",
  "vendedora",
  "comercial",
  "gastronomia",
  "gastronomía",
  "gastonomia",
  "mozo",
  "moza",
  "cocina",
  "desarrollador",
  "contador",
  "recursos humanos",
  "operario",
  "operaria",
  "operador",
  "operadora",
  "guardia de seguridad",
  "vigilante",
  "repositor",
  "repositora",
  "cajero",
  "cajera",
  "auxiliar de deposito",
  "auxiliar de depósito",
  "recepcionista",
  "electricista",
  "mecanico",
  "mecánico",
  "soldador",
  "soldadora",
  "enfermero",
  "enfermera",
  "cuidador",
  "cuidadora",
  "psicologo",
  "psicólogo",
  "psicologa",
  "psicóloga",
  "auxiliar de farmacia",
  "call center",
  "telemarketer",
  "tecnico",
  "técnico"
];

const LOCATION_HINTS = [...new Set(knownUruguayLocationNames().map(normalizeHint))];

const SKILL_HINTS = [
  "sistemas de facturacion",
  "sistemas de facturación",
  "sistema de facturacion",
  "sistema de facturación",
  "refrigeracion industrial",
  "refrigeración industrial",
  "aire acondicionado",
  "mecanica industrial",
  "mecánica industrial",
  "mantenimiento mecanico",
  "mantenimiento mecánico",
  "equipos industriales",
  "maquinaria industrial",
  "hidraulica",
  "hidráulica",
  "neumatica",
  "neumática",
  "diagnostico de fallas",
  "diagnóstico de fallas",
  "baterias industriales",
  "baterías industriales",
  "mantenimiento preventivo",
  "mantenimiento correctivo",
  "electricidad industrial",
  "electricidad",
  "soldadura",
  "amoniaco",
  "amoníaco",
  "nh3",
  "freon",
  "freón",
  "mejora continua",
  "lean",
  "six sigma",
  "excel",
  "power bi",
  "sql",
  "sap",
  "facturacion",
  "facturación",
  "logistica",
  "logística",
  "produccion",
  "producción",
  "calidad",
  "procesos",
  "mantenimiento",
  "compras",
  "ventas",
  "gestion de cartera",
  "gestión de cartera",
  "cartera de clientes",
  "visitas comerciales",
  "consumo masivo",
  "atencion al cliente",
  "atención al cliente",
  "gastronomia",
  "gastronomía",
  "gastonomia",
  "restaurante",
  "cocina",
  "cajero",
  "cajera",
  "mozo",
  "moza",
  "memory",
  "tango",
  "gns",
  "nodum",
  "odoo",
  "salesforce",
  "dynamics",
  "oracle",
  "genexus",
  "crm",
  "erp",
  "autoelevador",
  "montacargas",
  "forklift",
  "picking",
  "packing",
  "preparacion de pedidos",
  "preparación de pedidos",
  "libreta profesional",
  "libreta categoria c",
  "libreta categoría c",
  "cobranzas",
  "conciliaciones",
  "liquidacion de sueldos",
  "liquidación de sueldos",
  "payroll",
  "nomina",
  "nómina",
  "office",
  "python",
  "javascript"
];

const CONCEPT_PATTERNS: Array<{ pattern: RegExp; skill: string }> = [
  { pattern: /\b(?:sistemas?|programas?|software)\s+(?:de\s+)?facturaci[oó]n\b/i, skill: "sistemas de facturacion" },
  { pattern: /\b(?:refrigeraci[oó]n industrial|sistemas? de refrigeraci[oó]n|m[aá]quinas? de fr[ií]o|generaci[oó]n de fr[ií]o|equipos? de fr[ií]o|frigorista)\b/i, skill: "refrigeracion industrial" },
  { pattern: /\b(?:mantenimiento (?:preventivo|correctivo)|mantenimiento de (?:m[aá]quinas|equipos|sistemas)|mantenimiento industrial)\b/i, skill: "mantenimiento industrial" },
  { pattern: /\b(?:mec[aá]nica industrial|mec[aá]nico industrial|electromec[aá]nic[oa]|mantenimiento mec[aá]nico)\b/i, skill: "mecanica industrial" },
  { pattern: /\b(?:autoelevadores?|montacargas|forklifts?|equipos? de movimiento de materiales)\b/i, skill: "autoelevador" },
  { pattern: /\b(?:sistemas?|fallas?|circuitos?) hidr[aá]ulic[oa]s?|hidr[aá]ulica|neum[aá]tica\b/i, skill: "hidraulica" },
  { pattern: /\b(?:diagn[oó]stico|detecci[oó]n|resoluci[oó]n) de fallas?\b/i, skill: "diagnostico de fallas" },
  { pattern: /\b(?:equipos?|m[aá]quinas?|maquinaria) industriales?\b/i, skill: "equipos industriales" },
  { pattern: /\bbater[ií]as? (?:industriales?|de tracci[oó]n|de autoelevadores?)\b/i, skill: "baterias industriales" },
  { pattern: /\b(?:fre[oó]n|nh3|amon[ií]aco|gases? refrigerantes?)\b/i, skill: "refrigerantes industriales" },
  { pattern: /lider|jefatura|supervis|coordinar (?:un |el )?equipo|manejo de (?:personal|equipos)|personas a cargo/i, skill: "liderazgo" },
  { pattern: /organizad|planific|ordenad|gesti[oó]n del tiempo|seguimiento de tareas/i, skill: "organizacion" },
  { pattern: /comunicaci[oó]n|buen trato|trat(?:o|ar) con (?:el |los )?clientes?|relaciones interpersonales/i, skill: "comunicacion" },
  { pattern: /negoci|cierre de ventas|desarrollo de clientes|manejo de cuentas/i, skill: "negociacion" },
  { pattern: /\b(?:ventas?|vendedor(?:a)?)\s+(?:de|en)\s+terreno\b|\bvisitas? comerciales?\b/i, skill: "ventas de terreno" },
  { pattern: /\b(?:gesti[oó]n|gestionar|desarrollo|desarrollar|manejo|manejar)\s+(?:de\s+)?(?:la\s+)?cartera de clientes\b/i, skill: "gestion de cartera" },
  { pattern: /\bconsumo masivo\b/i, skill: "consumo masivo" },
  { pattern: /resolver problemas|resoluci[oó]n de problemas|anal[ií]tic|pensamiento cr[ií]tico/i, skill: "resolucion de problemas" },
  { pattern: /adaptab|flexib|trabajo bajo presi[oó]n|entorno din[aá]mico/i, skill: "adaptabilidad" },
  { pattern: /trabajo en equipo|colaboraci[oó]n|colaborativ/i, skill: "trabajo en equipo" },
  { pattern: /\b(?:carga\s+y\s+descarga|carga\/descarga|cargar\s+y\s+descargar)\b/i, skill: "carga y descarga" },
  { pattern: /\b(?:control|verificaci[oó]n)\s+(?:de\s+)?(?:stock|inventario|mercader[ií]a|contenedores?)\b/i, skill: "control de mercaderia" },
  { pattern: /\b(?:remitos?|documentaci[oó]n|control documental)\b/i, skill: "control documental" },
  { pattern: /\b(?:pesaje|balanza|control de peso)\b/i, skill: "pesaje" },
  { pattern: /\b(?:puerto|portuari[oa]|contenedores?)\b/i, skill: "operativa portuaria" }
];

function normalizeHint(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function findHints(query: string, hints: string[]) {
  const normalized = ` ${normalizeHint(query).replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const matches = hints
    .filter((hint) => {
      const normalizedHint = normalizeHint(hint).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      return normalized.includes(` ${normalizedHint} `);
    })
    .sort((left, right) => normalizeHint(right).length - normalizeHint(left).length);
  const filtered = matches.filter((hint, index) => !matches.slice(0, index).some((longer) => {
    const normalizedHint = normalizeHint(hint);
    const normalizedLonger = normalizeHint(longer);
    return normalizedLonger.includes(normalizedHint) && normalizedLonger !== normalizedHint;
  }));
  const unique = new Map<string, string>();
  for (const hint of filtered) {
    const normalizedHint = normalizeHint(hint);
    if (!unique.has(normalizedHint)) unique.set(normalizedHint, hint);
  }
  return [...unique.values()];
}

function canonicalSkill(skill: string) {
  const normalized = normalizeHint(skill);
  if ([
    "sistema de facturacion",
    "sistemas de facturacion",
    "software de facturacion",
    "programa de facturacion"
  ].includes(normalized)) return "sistemas de facturacion";
  return normalized;
}

function isDetailedJobDescription(query: string) {
  const normalized = normalizeHint(query);
  return normalized.length >= 180
    || /\b(?:tareas?|funciones?|responsabilidades?|horario|requisitos?)\s*:/.test(normalized)
    || normalized.split(/[.;\n]+/).filter((part) => part.trim().length > 20).length >= 3;
}

function isAdministrativeWarehouseDescription(query: string) {
  const normalized = normalizeHint(query);
  const hasWarehouse = /\b(?:deposito|almacen|logistica|stock|inventario|mercaderia|contenedores?|carga|descarga|puerto|pesaje)\b/.test(normalized);
  const hasAdministrativeControl = /\b(?:administrativ|documentaci|documental|remitos?|verific|control|pesaje|apuntador)\b/.test(normalized);
  return isDetailedJobDescription(query) && hasWarehouse && hasAdministrativeControl;
}

function isIndustrialRefrigerationDescription(query: string) {
  const normalized = normalizeHint(query);
  return /\b(?:refrigeracion industrial|sistemas? de refrigeracion|maquinas? de frio|generacion de frio|frigorista|freon|nh3|amoniaco)\b/.test(normalized);
}

function isIndustrialMechanicDescription(query: string) {
  const normalized = normalizeHint(query);
  const mechanicIdentity = /\b(?:mecanico industrial|electromecanico|tecnico (?:mecanico|electromecanico|de mantenimiento)|mecanica industrial)\b/.test(normalized);
  const industrialContext = /\b(?:industrial|equipos?|maquinas?|maquinaria|autoelevadores?|montacargas|forklift|hidraulica|neumatica|baterias?)\b/.test(normalized);
  const equipmentMaintenance = /\b(?:reparacion|mantenimiento|diagnostico|fallas?)\b/.test(normalized)
    && /\b(?:autoelevadores?|montacargas|forklift|equipos? industriales?|maquinas?|maquinaria)\b/.test(normalized);
  return !isIndustrialRefrigerationDescription(query)
    && ((mechanicIdentity && industrialContext) || equipmentMaintenance);
}

function isFieldSalesDescription(query: string) {
  const normalized = normalizeHint(query);
  return /\b(?:ventas?|vendedor(?:a)?)\s+(?:de|en)\s+terreno\b|\bvisitas? comerciales?\b/.test(normalized)
    || (
      /\b(?:vendedor(?:a)?|comercial|ventas?)\b/.test(normalized)
      && /\b(?:cartera de clientes|venta directa|canal de reventa|desarrollo de clientes)\b/.test(normalized)
    );
}

function optionalConceptsForQuery(query: string, concepts: string[]) {
  const normalized = normalizeHint(query);
  const optionalMarker = /\b(?:se valora(?:ra)?|deseable|preferentemente|pueden ser favorables?)\b/;
  const optionalConcepts = new Set<string>();

  for (const concept of concepts) {
    const normalizedConcept = normalizeHint(concept);
    let conceptPosition = normalized.indexOf(normalizedConcept);
    while (conceptPosition >= 0) {
      const previousBoundary = Math.max(
        normalized.lastIndexOf(".", conceptPosition),
        normalized.lastIndexOf(";", conceptPosition),
        normalized.lastIndexOf("\n", conceptPosition)
      );
      const followingBoundaries = [
        normalized.indexOf(".", conceptPosition),
        normalized.indexOf(";", conceptPosition),
        normalized.indexOf("\n", conceptPosition)
      ].filter((position) => position >= 0);
      const followingBoundary = followingBoundaries.length ? Math.min(...followingBoundaries) : normalized.length;
      const clause = normalized.slice(Math.max(0, previousBoundary + 1), followingBoundary);
      const precedingContext = normalized.slice(Math.max(0, previousBoundary - 100), conceptPosition);
      if (optionalMarker.test(clause) || optionalMarker.test(precedingContext)) {
        optionalConcepts.add(normalizedConcept);
        break;
      }
      conceptPosition = normalized.indexOf(normalizedConcept, conceptPosition + normalizedConcept.length);
    }
  }
  return optionalConcepts;
}

function requiredGroupsForQuery(
  query: string,
  roles: string[],
  skills: string[],
  languages: string[],
  industries: string[]
) {
  const normalized = normalizeHint(query);
  const optionalConcepts = optionalConceptsForQuery(query, [...skills, ...industries]);
  const requiredConceptAliases: Record<string, string[]> = {
    "sistemas de facturacion": [
      "sistema de facturacion", "sistemas de facturacion", "software de facturacion",
      "programa de facturacion", "facturacion electronica", "emision de facturas",
      "facturacion", "memory", "tango", "gns", "nodum", "odoo", "sap", "erp"
    ]
  };
  const groups = [...roles, ...skills, ...languages, ...industries]
    .filter((concept) => !optionalConcepts.has(normalizeHint(concept)))
    .map((concept) => requiredConceptAliases[normalizeHint(concept)] ?? [concept]);
  if (isIndustrialRefrigerationDescription(query)) {
    return [
      [
        "maquinista de refrigeracion", "tecnico en refrigeracion", "tecnico frigorista",
        "frigorista", "refrigeracion industrial", "sistemas de refrigeracion",
        "maquinas de frio", "equipos de frio", "generacion de frio", "aire acondicionado"
      ],
      [
        "mantenimiento industrial", "mantenimiento preventivo", "mantenimiento correctivo",
        "mantenimiento de equipos", "mantenimiento de maquinas", "reparacion"
      ]
    ];
  }
  if (isIndustrialMechanicDescription(query)) {
    return [
      [
        "mecanico industrial", "mecanico", "tecnico mecanico", "electromecanico",
        "tecnico electromecanico", "tecnico de mantenimiento", "mantenimiento mecanico",
        "mecanica industrial"
      ],
      [
        "mantenimiento industrial", "mantenimiento preventivo", "mantenimiento correctivo",
        "reparacion de equipos", "equipos industriales", "maquinaria industrial",
        "autoelevador", "montacargas", "forklift", "hidraulica", "neumatica",
        "electricidad industrial", "diagnostico de fallas"
      ]
    ];
  }
  if (isFieldSalesDescription(query)) {
    return [[
      "vendedor de terreno", "vendedora de terreno", "ventas de terreno", "venta de terreno",
      "vendedor viajante", "preventista", "ejecutivo comercial", "ejecutiva comercial",
      "representante comercial", "venta directa", "visitas comerciales",
      "gestion de cartera", "cartera de clientes", "desarrollo de clientes"
    ]];
  }
  if (isAdministrativeWarehouseDescription(query)) {
    return [
      [
        "administrativo", "administrativa", "administracion", "control documental",
        "documentacion", "remito", "remitos", "verificador", "apuntador", "pesaje"
      ],
      [
        "deposito", "almacen", "logistica", "stock", "inventario", "mercaderia",
        "carga", "descarga", "contenedor", "contenedores", "puerto"
      ]
    ];
  }
  if (/\b(chofer|conductor|ambulanciero)\b/.test(normalized) && /\b(ambulancia|emergencia movil|traslado de pacientes)\b/.test(normalized)) {
    return [
      ["chofer", "conductor", "driver", "ambulanciero"],
      ["ambulancia", "emergencia movil", "emergencia medica", "traslado de pacientes"],
      ...groups.filter((group) => !roles.includes(group[0]))
    ];
  }
  const unique = new Map<string, string[]>();
  for (const group of groups) {
    const key = group.map(normalizeHint).sort().join("|");
    if (key && !unique.has(key)) unique.set(key, group);
  }
  return [...unique.values()];
}

function locationGroupsForQuery(locations: string[]) {
  return locations.map((location) => nearbyUruguayLocations(location).map(normalizeHint));
}

function basicProfileRequested(query: string) {
  const normalized = normalizeHint(query);
  return /\b(?:sin experiencia|no (?:necesita|necesitan|requiere|requieren) (?:tener )?experiencia|trabajo (?:basico|operativo)|perfil (?:basico|operativo)|puesto (?:basico|operativo))\b/.test(normalized)
    || (/\bsupermercad/.test(normalized) && /\b(?:sin experiencia|no requiere|no necesitan)\b/.test(normalized));
}

function strictLocationRequested(query: string) {
  const normalized = normalizeHint(query);
  return /\b(?:excluyente|obligatorio|obligatoria|indispensable|unicamente|solo)\b.{0,50}\b(?:vivir|viva|vivan|residir|resida|residan|domicilio|residencia)\b/.test(normalized)
    || /\b(?:tiene que|debe|deben|preciso que|necesito que)\s+(?:vivir|viva|vivan|ser|sean|residir)\b/.test(normalized)
    || /\bresidentes?\s+de\b/.test(normalized)
    || /\b(?:domicilio|residencia)\s+(?:obligatorio|obligatoria|excluyente)\b/.test(normalized);
}

function ignoredSensitiveCriteria(query: string) {
  const normalized = normalizeHint(query);
  return /\b(?:hombre|hombres|varon|varones|mujer|mujeres|sexo|genero)\b/.test(normalized) ? ["genero"] : [];
}

function residualKeywords(query: string, knownConcepts: string[]) {
  const queryWithoutWorkplace = query
    .replace(/^\s*(?:cliente|empresa|horarios?|jornada|periodo\s+de\s+trabajo|modalidad|valor\s+hora|salario|sueldo|remuneracion|remuneración)\s*:\s*.*$/gimu, " ")
    .replace(/\b(?:para|en)\s+(?:la\s+)?zona\s+[^,.;]+/giu, " ")
    .replace(/\b(?:lugar|zona|ubicacion|ubicación)\s+de\s+trabajo\s*:\s*[^,.;]+/giu, " ");
  const ignoredWords = new Set([
    "busco", "buscar", "buscando", "estoy", "necesito", "preciso", "persona", "alguien",
    "perfil", "candidato", "candidata", "con", "sin", "para", "por", "experiencia",
    "experiencias", "tener", "tenga", "tengan", "que", "una", "uno", "trabajar", "trabajo",
    "necesita", "necesitan", "requiere", "requieren", "especifica", "especifico", "alguna",
    "algun", "alguno", "tiene", "tenido", "haya", "hayan", "debe", "deben", "sean", "sea", "ser", "puesto", "cargo",
    "cerca", "alrededores", "vivir", "vive", "viva", "residir", "residente", "residentes",
    "manejo", "conocimiento", "conocimientos", "nivel", "buen", "buena", "muy", "del", "las",
    "los", "como", "hombre", "hombres", "mujer", "mujeres", "organizada", "organizado",
    "coordinar", "equipo", "equipos", "tratar", "clientes", "zona",
    "tarea", "tareas", "funcion", "funciones", "implica", "implican", "responsable",
    "responsables", "proceso", "procesos", "controlando", "horario", "lunes", "martes",
    "miercoles", "jueves", "viernes", "sabado", "sabados", "domingo", "domingos",
    "algun", "alguna", "requerido", "requerida", "pesos", "cliente", "empresa",
    "jornada", "periodo", "modalidad", "valor", "hora", "horas", "nominal",
    "salario", "sueldo", "remuneracion", "convocatoria", "demanda", "partir",
    "responsabilidad", "responsabilidades", "garantizar", "correcto", "funcionamiento",
    "realizar", "efectuar", "ejecutar", "general", "generales", "diaria", "diarias",
    "registrar", "detectar", "reparar", "posible", "posibles", "requisito", "requisitos",
    "secundaria", "completa", "equivalente", "formacion", "tecnica", "tecnico",
    "profesional", "deseable", "area", "areas", "afines", "minima", "minimo", "anos", "valora",
    "valorara", "especialmente", "sistemas", "maquinas", "niveles", "consumos",
    "busqueda", "esta", "orientada", "canal", "persona", "sera", "desarrollar",
    "gestionar", "estructura", "definida", "actividades", "objetivos", "incluyendo",
    "indicadores", "gestion", "entre", "otros", "consideramos", "perfiles", "pueden",
    "favorables", "reventa", "trabajando"
  ]);
  const knownTokens = new Set(knownConcepts
    .flatMap((concept) => normalizeHint(concept).split(/[^\p{L}\p{N}]+/u))
    .filter(Boolean));
  const keywords = [...new Set(normalizeHint(queryWithoutWorkplace)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4 && !ignoredWords.has(word) && !knownTokens.has(word)))];
  return keywords.slice(0, isDetailedJobDescription(query) ? 8 : 20);
}

function experienceRequirement(query: string) {
  const normalized = normalizeHint(query);
  const match = normalized.match(/\b(?:(mas de|superior a|mayor a|al menos|minim[oa]|como minimo)\s*)?(\d{1,2})\s*(anos?|mes(?:es)?)\s*(?:de\s*)?(?:experiencia|trayectoria)?\b/);
  if (!match) return { months: null, comparator: null } as const;
  const amount = Number(match[2]);
  if (!amount || amount > 59) return { months: null, comparator: null } as const;
  return {
    months: /ano/.test(match[3]) ? amount * 12 : amount,
    comparator: /^(?:mas de|superior a|mayor a)$/.test(match[1] ?? "") ? "more_than" as const : "at_least" as const
  };
}

export function interpretTalentQuery(query: string): InterpretedTalentQuery {
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  const detectedRoles = findHints(normalizedQuery, ROLE_HINTS);
  const roles = [...new Set([
    ...detectedRoles,
    ...(isIndustrialRefrigerationDescription(normalizedQuery) && detectedRoles.length === 0 ? ["tecnico en refrigeracion"] : []),
    ...(isIndustrialMechanicDescription(normalizedQuery) && detectedRoles.length === 0 ? ["mecanico industrial"] : []),
    ...(isFieldSalesDescription(normalizedQuery) ? ["vendedor de terreno"] : []),
    ...(isAdministrativeWarehouseDescription(normalizedQuery) ? ["auxiliar de deposito"] : [])
  ])];
  const skills = [...new Set([
    ...findHints(normalizedQuery, SKILL_HINTS),
    ...CONCEPT_PATTERNS.filter(({ pattern }) => pattern.test(normalizedQuery)).map(({ skill }) => skill)
  ].map(canonicalSkill))];
  const languages = LANGUAGE_PATTERNS.filter(([pattern]) => pattern.test(normalizedQuery)).map(([, language]) => language);
  const seniority = SENIORITY_PATTERNS.find(([pattern]) => pattern.test(normalizedQuery))?.[1] ?? null;
  const industries = findHints(normalizedQuery, ["supermercado", "industria", "fabrica", "fábrica", "retail", "logistica", "logística", "manufactura", "tecnologia", "tecnología", "gastronomia", "gastronomía", "restaurante", "lubricantes", "consumo masivo"]);
  const locations = findHints(normalizedQuery, LOCATION_HINTS);
  const profileLevel = basicProfileRequested(normalizedQuery) ? "basic" : null;
  const keywords = residualKeywords(normalizedQuery, [...roles, ...skills, ...languages, ...industries, ...locations]);
  const experience = experienceRequirement(normalizedQuery);

  return {
    originalQuery: query,
    normalizedQuery,
    roles,
    skills,
    languages,
    seniority,
    industries,
    locations,
    keywords,
    locationGroups: locationGroupsForQuery(locations),
    locationStrict: strictLocationRequested(normalizedQuery),
    profileLevel,
    ignoredCriteria: ignoredSensitiveCriteria(normalizedQuery),
    mustHave: [...roles, ...skills, ...languages, ...locations, ...keywords],
    requiredGroups: requiredGroupsForQuery(normalizedQuery, roles, skills, languages, industries),
    minimumRelevantExperienceMonths: experience.months,
    experienceComparator: experience.comparator
  };
}
