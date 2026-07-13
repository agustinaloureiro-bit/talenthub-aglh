import type { InterpretedTalentQuery } from "./types.js";

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
  "abogado",
  "abogada",
  "legal",
  "asesor legal",
  "asesora legal",
  "ingeniero industrial",
  "ingeniero",
  "analista",
  "administrativo",
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

const SKILL_HINTS = [
  "mejora continua",
  "lean",
  "six sigma",
  "excel",
  "power bi",
  "sql",
  "sap",
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
  "moza"
];

function normalizeHint(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function findHints(query: string, hints: string[]) {
  const normalized = normalizeHint(query);
  return hints.filter((hint) => normalized.includes(normalizeHint(hint)));
}

export function interpretTalentQuery(query: string): InterpretedTalentQuery {
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  const roles = findHints(normalizedQuery, ROLE_HINTS);
  const skills = findHints(normalizedQuery, SKILL_HINTS);
  const languages = LANGUAGE_PATTERNS.filter(([pattern]) => pattern.test(normalizedQuery)).map(([, language]) => language);
  const seniority = SENIORITY_PATTERNS.find(([pattern]) => pattern.test(normalizedQuery))?.[1] ?? null;
  const industries = findHints(normalizedQuery, ["industria", "retail", "logistica", "logística", "manufactura", "tecnologia", "tecnología", "gastronomia", "gastronomía", "restaurante"]);

  return {
    originalQuery: query,
    normalizedQuery,
    roles,
    skills,
    languages,
    seniority,
    industries,
    mustHave: [...roles, ...skills, ...languages]
  };
}
