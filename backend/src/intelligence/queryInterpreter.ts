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
  "tecnico",
  "técnico"
];

const LOCATION_HINTS = [...new Set(knownUruguayLocationNames().map(normalizeHint))];

const SKILL_HINTS = [
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
  "python",
  "javascript"
];

const CONCEPT_PATTERNS: Array<{ pattern: RegExp; skill: string }> = [
  { pattern: /lider|jefatura|supervis|coordinar (?:un |el )?equipo|manejo de (?:personal|equipos)|personas a cargo/i, skill: "liderazgo" },
  { pattern: /organizad|planific|ordenad|gesti[oó]n del tiempo|seguimiento de tareas/i, skill: "organizacion" },
  { pattern: /comunicaci[oó]n|buen trato|trat(?:o|ar) con (?:el |los )?clientes?|relaciones interpersonales/i, skill: "comunicacion" },
  { pattern: /negoci|cierre de ventas|desarrollo de clientes|manejo de cuentas/i, skill: "negociacion" },
  { pattern: /resolver problemas|resoluci[oó]n de problemas|anal[ií]tic|pensamiento cr[ií]tico/i, skill: "resolucion de problemas" },
  { pattern: /adaptab|flexib|trabajo bajo presi[oó]n|entorno din[aá]mico/i, skill: "adaptabilidad" },
  { pattern: /trabajo en equipo|colaboraci[oó]n|colaborativ/i, skill: "trabajo en equipo" }
];

function normalizeHint(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function findHints(query: string, hints: string[]) {
  const normalized = normalizeHint(query);
  const matches = hints
    .filter((hint) => normalized.includes(normalizeHint(hint)))
    .sort((left, right) => normalizeHint(right).length - normalizeHint(left).length);
  return matches.filter((hint, index) => !matches.slice(0, index).some((longer) => {
    const normalizedHint = normalizeHint(hint);
    const normalizedLonger = normalizeHint(longer);
    return normalizedLonger.includes(normalizedHint) && normalizedLonger !== normalizedHint;
  }));
}

function requiredGroupsForQuery(query: string, roles: string[]) {
  const normalized = normalizeHint(query);
  if (/\b(chofer|conductor|ambulanciero)\b/.test(normalized) && /\b(ambulancia|emergencia movil|traslado de pacientes)\b/.test(normalized)) {
    return [
      ["chofer", "conductor", "driver", "ambulanciero"],
      ["ambulancia", "emergencia movil", "emergencia medica", "traslado de pacientes"]
    ];
  }
  return roles.map((role) => [role]);
}

function locationGroupsForQuery(locations: string[]) {
  return locations.map((location) => nearbyUruguayLocations(location).map(normalizeHint));
}

function basicProfileRequested(query: string) {
  const normalized = normalizeHint(query);
  return /\b(?:sin experiencia|no (?:necesita|necesitan|requiere|requieren) (?:tener )?experiencia|trabajo (?:basico|operativo)|perfil (?:basico|operativo)|puesto (?:basico|operativo))\b/.test(normalized)
    || (/\bsupermercad/.test(normalized) && /\b(?:sin experiencia|no requiere|no necesitan)\b/.test(normalized));
}

function ignoredSensitiveCriteria(query: string) {
  const normalized = normalizeHint(query);
  return /\b(?:hombre|hombres|varon|varones|mujer|mujeres|sexo|genero)\b/.test(normalized) ? ["genero"] : [];
}

export function interpretTalentQuery(query: string): InterpretedTalentQuery {
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  const roles = findHints(normalizedQuery, ROLE_HINTS);
  const skills = [...new Set([
    ...findHints(normalizedQuery, SKILL_HINTS),
    ...CONCEPT_PATTERNS.filter(({ pattern }) => pattern.test(normalizedQuery)).map(({ skill }) => skill)
  ])];
  const languages = LANGUAGE_PATTERNS.filter(([pattern]) => pattern.test(normalizedQuery)).map(([, language]) => language);
  const seniority = SENIORITY_PATTERNS.find(([pattern]) => pattern.test(normalizedQuery))?.[1] ?? null;
  const industries = findHints(normalizedQuery, ["supermercado", "industria", "retail", "logistica", "logística", "manufactura", "tecnologia", "tecnología", "gastronomia", "gastronomía", "restaurante"]);
  const locations = findHints(normalizedQuery, LOCATION_HINTS);
  const profileLevel = basicProfileRequested(normalizedQuery) ? "basic" : null;

  return {
    originalQuery: query,
    normalizedQuery,
    roles,
    skills,
    languages,
    seniority,
    industries,
    locations,
    locationGroups: locationGroupsForQuery(locations),
    profileLevel,
    ignoredCriteria: ignoredSensitiveCriteria(normalizedQuery),
    mustHave: [...roles, ...skills, ...languages, ...locations],
    requiredGroups: requiredGroupsForQuery(normalizedQuery, roles)
  };
}
