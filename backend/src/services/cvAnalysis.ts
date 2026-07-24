import { knownUruguayLocationNames } from "../intelligence/uruguayGeography.js";

export type CvLanguageEvidence = {
  lang: string;
  level: string | null;
  evidence: string;
};

export type CvAnalysis = {
  hasReadableText: boolean;
  summary: string | null;
  primaryRole: string | null;
  roles: string[];
  skills: string[];
  languages: CvLanguageEvidence[];
  years: number | null;
  city: string | null;
  country: string | null;
  experienceHighlights: string[];
  educationHighlights: string[];
  confidence: "alta" | "media" | "baja";
  warning: string | null;
};

type EvidenceRule = { label: string; pattern: RegExp };

const ROLE_RULES: EvidenceRule[] = [
  { label: "chofer de ambulancia", pattern: /\b(?:chofer|conductor(?:a)?)\s+de\s+ambulancia\b|\bambulancier[oa]\b/i },
  { label: "abogado", pattern: /\b(?:abogad[oa]|asesor(?:a)? legal|derecho (?:laboral|corporativo|civil|penal)|jur[ií]dic[oa])\b/i },
  { label: "auxiliar administrativo", pattern: /\b(?:auxiliar|asistente)\s+administrativ[oa]\b|\bback office\b/i },
  { label: "auxiliar contable", pattern: /\b(?:auxiliar|asistente)\s+contable\b/i },
  { label: "guardia de seguridad", pattern: /\b(?:guardia de seguridad|vigilante|vigilancia|seguridad f[ií]sica)\b/i },
  { label: "operario de produccion", pattern: /\b(?:operari[oa]\s+de\s+(?:producci[oó]n|f[aá]brica|planta)|operador(?:a)? de (?:maquinaria|producci[oó]n)|auxiliar de producci[oó]n|l[ií]nea de producci[oó]n)\b/i },
  { label: "auxiliar de deposito", pattern: /\b(?:auxiliar|operari[oa]|pe[oó]n)\s+de\s+dep[oó]sito\b|\b(?:picking|packing|preparaci[oó]n de pedidos)\b/i },
  { label: "operario", pattern: /\boperari[oa]\b/i },
  { label: "repositor", pattern: /\b(?:repositor(?:a)?|reponedor(?:a)?|reposici[oó]n de (?:mercader[ií]a|g[oó]ndolas))\b/i },
  { label: "cajero", pattern: /\b(?:cajer[oa]|manejo de caja|arqueo de caja)\b/i },
  { label: "limpieza", pattern: /\b(?:auxiliar de servicio|operari[oa] de limpieza|limpiador(?:a)?|tareas de limpieza)\b/i },
  { label: "recepcionista", pattern: /\b(?:recepcionista|recepci[oó]n y atenci[oó]n)\b/i },
  { label: "call center", pattern: /\b(?:call center|contact center|telemarketer|telemarketing|operador(?:a)? telef[oó]nic[oa])\b/i },
  { label: "electricista", pattern: /\b(?:electricista|electricidad industrial|instalaciones el[eé]ctricas)\b/i },
  { label: "mecanico", pattern: /\b(?:mec[aá]nic[oa]|mec[aá]nica automotriz|mantenimiento mec[aá]nico)\b/i },
  { label: "soldador", pattern: /\b(?:soldador(?:a)?|soldadura|mig|mag|tig)\b/i },
  { label: "construccion", pattern: /\b(?:alba[nñ]il|construcci[oó]n|obra civil|ayudante de obra)\b/i },
  { label: "enfermeria", pattern: /\b(?:enfermer[oa]|auxiliar de enfermer[ií]a|licenciad[oa] en enfermer[ií]a)\b/i },
  { label: "cuidados", pattern: /\b(?:cuidador(?:a)?|acompa[nñ]ante terap[eé]utic[oa]|cuidado de (?:adultos|pacientes))\b/i },
  { label: "psicologia", pattern: /\b(?:psic[oó]log[oa]|licenciad[oa] en psicolog[ií]a)\b/i },
  { label: "farmacia", pattern: /\b(?:auxiliar de farmacia|id[oó]neo en farmacia|farmac[eé]utic[oa])\b/i },
  { label: "ventas", pattern: /\b(?:ventas?|vendedor(?:a)?|ejecutiv[oa] comercial|asesor(?:a)? comercial)\b/i },
  { label: "gastronomia", pattern: /\b(?:gastronom[ií]a|restaurante|mozo|moza|cociner[oa]|ayudante de cocina|barista)\b/i },
  { label: "administracion", pattern: /\b(?:administraci[oó]n|administrativ[oa]|auxiliar administrativo)\b/i },
  { label: "atencion al cliente", pattern: /\b(?:atenci[oó]n al cliente|servicio al cliente|customer service)\b/i },
  { label: "logistica", pattern: /\b(?:log[ií]stica|dep[oó]sito|almac[eé]n|warehouse|inventario)\b/i },
  { label: "contabilidad", pattern: /\b(?:contabilidad|contador(?:a)?|auxiliar contable|liquidaci[oó]n de sueldos)\b/i },
  { label: "recursos humanos", pattern: /\b(?:recursos humanos|reclutamiento|selecci[oó]n de personal|gesti[oó]n humana)\b/i },
  { label: "marketing", pattern: /\b(?:marketing|community manager|redes sociales|publicidad)\b/i },
  { label: "tecnologia", pattern: /\b(?:desarrollador(?:a)?|programador(?:a)?|software|soporte t[eé]cnico|testing|qa automation)\b/i },
  { label: "ingenieria", pattern: /\b(?:ingenier[oa]|ingenier[ií]a)\b/i },
  { label: "produccion", pattern: /\b(?:producci[oó]n|operari[oa]|manufactura)\b/i },
  { label: "mantenimiento", pattern: /\b(?:mantenimiento|electromec[aá]nic[oa]|electricista)\b/i },
  { label: "chofer", pattern: /\b(?:chofer|conductor(?:a)?|repartidor(?:a)?|cadete|delivery)\b/i },
  { label: "salud", pattern: /\b(?:enfermer[oa]|auxiliar de enfermer[ií]a|m[eé]dic[oa]|cuidador(?:a)?)\b/i }
];

const SKILL_RULES: EvidenceRule[] = [
  { label: "excel", pattern: /\bexcel\b/i },
  { label: "power bi", pattern: /\bpower\s*bi\b/i },
  { label: "sap", pattern: /\bsap\b/i },
  { label: "sql", pattern: /\bsql\b/i },
  { label: "caja", pattern: /\b(?:manejo de caja|cajer[oa])\b/i },
  { label: "facturacion", pattern: /\bfacturaci[oó]n\b/i },
  { label: "compras", pattern: /\bcompras\b/i },
  { label: "inventario", pattern: /\b(?:inventario|control de stock)\b/i },
  { label: "autoelevador", pattern: /\b(?:autoelevador|montacargas|forklift)\b/i },
  { label: "picking", pattern: /\bpicking\b|\bpreparaci[oó]n de pedidos\b/i },
  { label: "packing", pattern: /\bpacking\b|\bembalaje\b|\bempaque\b/i },
  { label: "libreta profesional", pattern: /\b(?:libreta|licencia)\s+(?:de conducir\s+)?(?:categor[ií]a\s+)?(?:a|b|c|d|e|f|h)\b|\blibreta profesional\b/i },
  { label: "cobranzas", pattern: /\b(?:cobranza|gesti[oó]n de morosos|recuperaci[oó]n de deuda)\b/i },
  { label: "conciliaciones", pattern: /\b(?:conciliaci[oó]n bancaria|conciliaciones)\b/i },
  { label: "liquidacion de sueldos", pattern: /\b(?:liquidaci[oó]n de sueldos|n[oó]mina|payroll|b[oó]ps)\b/i },
  { label: "memory", pattern: /\bmemory\b/i },
  { label: "tango", pattern: /\btango gesti[oó]n\b|\bsistema tango\b/i },
  { label: "odoo", pattern: /\bodoo\b/i },
  { label: "nodum", pattern: /\bnodum\b/i },
  { label: "genexus", pattern: /\bgenexus\b/i },
  { label: "salesforce", pattern: /\bsalesforce\b/i },
  { label: "crm", pattern: /\bcrm\b/i },
  { label: "erp", pattern: /\berp\b/i },
  { label: "office", pattern: /\b(?:microsoft office|paquete office|word|outlook)\b/i },
  { label: "liderazgo", pattern: /\b(?:liderazgo|supervisi[oó]n de equipo|jefatura)\b/i },
  { label: "negociacion", pattern: /\bnegociaci[oó]n\b/i }
];

const LANGUAGE_RULES: EvidenceRule[] = [
  { label: "ingles", pattern: /\b(?:ingl[eé]s|english)\b/i },
  { label: "portugues", pattern: /\b(?:portugu[eé]s|portuguese)\b/i },
  { label: "frances", pattern: /\b(?:franc[eé]s|french)\b/i },
  { label: "italiano", pattern: /\bitaliano\b/i }
];

const URUGUAY_LOCATIONS = knownUruguayLocationNames();
const ADDRESS_LOCATION_RULES: EvidenceRule[] = [
  { label: "Montevideo", pattern: /\b(?:camino maldonado|avenida 8 de octubre|av\.?\s*italia|propios|general flores|jos[eé] belloni|ruta 8)\b/i },
  { label: "Ciudad de la Costa", pattern: /\b(?:giannattasio|interbalnearia)\b/i }
];

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function earliestKnownLocation(value: string) {
  const normalized = normalize(value);
  return URUGUAY_LOCATIONS
    .map((location) => ({ location, index: normalized.search(new RegExp(`\\b${normalize(location).replace(/\s+/g, "\\s+")}\\b`, "i")) }))
    .filter((match) => match.index >= 0)
    .sort((left, right) => left.index - right.index || right.location.length - left.location.length)[0]?.location ?? null;
}

function withoutStreetPlaceNames(value: string) {
  const normalized = normalize(value);
  return URUGUAY_LOCATIONS.reduce((result, location) => {
    const place = normalize(location).replace(/\s+/g, "\\s+");
    return result.replace(new RegExp(`\\b(?:camino|calle|avenida|av|ruta|bulevar|boulevard)\\s+${place}\\b`, "gi"), " ");
  }, normalized);
}

function landmarkLocation(value: string) {
  return ADDRESS_LOCATION_RULES.find((rule) => rule.pattern.test(value))?.label ?? null;
}

function declaredLocation(value: string) {
  const match = /\b(?:domicilio|direcci[oó]n|ubicaci[oó]n|localidad|barrio|lugar de residencia|residencia|radicad[oa] en|vive en)\s*[:\-]?\s*([\s\S]{3,140})/i.exec(value);
  if (!match) return null;
  const location = match[1]
    .split(/\b(?:tel[eé]fono|celular|m[oó]vil|email|correo|fecha de nacimiento|edad|nacionalidad|documento|c[eé]dula|experiencia|educaci[oó]n|formaci[oó]n|estudios)\b/i)[0]
    .replace(/^[\s,.;:/|_-]+|[\s,.;:/|_-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (location.length < 3 || location.length > 100 || !/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3}/.test(location) || /@/.test(location)) return null;
  const knownPlace = earliestKnownLocation(withoutStreetPlaceNames(location));
  if (knownPlace) return knownPlace;
  const landmark = landmarkLocation(location);
  if (landmark) return landmark;
  return location.replace(/,?\s*Uruguay\s*$/i, "").trim() || null;
}

export function extractCvResidence(input: string) {
  const compact = String(input ?? "").replace(/\u0000/g, " ").replace(/\s+/g, " ").trim();
  if (!compact) return null;
  const personalMarker = /\b(?:datos personales|informaci[oó]n personal|contacto|domicilio|direcci[oó]n|ubicaci[oó]n|localidad|barrio|departamento|lugar de residencia|residencia\s*:|radicad[oa] en|vive en)\b/i.exec(compact);
  const professionalMarker = /\b(?:experiencia laboral|experiencia profesional|trayectoria(?: laboral| profesional)?|antecedentes laborales|historial laboral|empleos?|educaci[oó]n|formaci[oó]n|estudios(?: b[aá]sicos| avanzados)?)\b/i.exec(compact);
  const frontMatterEnd = Math.min(professionalMarker?.index ?? 2_400, 2_400);
  const frontMatter = compact.slice(0, frontMatterEnd);
  const hasContactEvidence = Boolean(
    personalMarker
    || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(frontMatter)
    || /(?:\+?598\s?)?(?:0?9\d|2\d|4\d)[\s.-]?\d{3}[\s.-]?\d{3,4}/.test(frontMatter)
  );

  // Many CV templates put the address in the header, before "Información personal".
  // Only inspect the front matter: locations appearing in jobs or studies are not residence evidence.
  if (hasContactEvidence) {
    const frontMatterCity = declaredLocation(frontMatter)
      ?? earliestKnownLocation(withoutStreetPlaceNames(frontMatter))
      ?? landmarkLocation(frontMatter);
    if (frontMatterCity) return { city: frontMatterCity, country: "Uruguay" };
  }

  if (!personalMarker || personalMarker.index == null) return null;
  const afterMarker = compact.slice(personalMarker.index, personalMarker.index + 1_400);
  const markerOffset = personalMarker[0].length + 20;
  const stop = /\b(?:web\s*&\s*redes|conocimientos|experiencia laboral|trayectoria|estudios b[aá]sicos|educaci[oó]n|formaci[oó]n)\b/i.exec(afterMarker.slice(markerOffset));
  const segment = stop?.index == null ? afterMarker : afterMarker.slice(0, markerOffset + stop.index);
  const city = earliestKnownLocation(withoutStreetPlaceNames(segment)) ?? landmarkLocation(segment) ?? declaredLocation(segment);
  if (city) return { city, country: "Uruguay" };
  return null;
}

function cleanLine(value: string) {
  return value
    .replace(/\u0000/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, " ")
    .replace(/[•·|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readableLine(value: string) {
  const line = cleanLine(value);
  if (line.length < 18 || line.length > 240) return "";
  if (/^%PDF-|endobj|xref|startxref|\/FlateDecode|\/XObject|Google Docs Renderer/i.test(line)) return "";
  const letters = (line.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) ?? []).length;
  if (letters / Math.max(1, line.length) < 0.5) return "";
  return line;
}

function evidenceAround(text: string, pattern: RegExp, radius = 70) {
  const match = pattern.exec(text);
  if (!match || match.index == null) return "";
  const start = Math.max(0, match.index - radius);
  const end = Math.min(text.length, match.index + match[0].length + radius);
  return readableLine(text.slice(start, end)) || cleanLine(match[0]);
}

function labelsFor(text: string, rules: EvidenceRule[]) {
  return rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label);
}

function primaryRoleFor(text: string) {
  const candidates = ROLE_RULES.flatMap((rule) => {
    const match = rule.pattern.exec(text);
    return match?.index == null ? [] : [{ label: rule.label, index: match.index }];
  });
  return candidates.sort((left, right) => left.index - right.index)[0]?.label ?? null;
}

function extractYears(text: string) {
  const matches = [
    ...text.matchAll(/(?:m[aá]s de|mas de|cuento con|con)\s*(\d{1,2})\s*a[nñ]os?\s*(?:de\s*)?(?:experiencia|trayectoria)/gi),
    ...text.matchAll(/(?:experiencia|trayectoria)[^.;\n]{0,55}?(\d{1,2})\s*a[nñ]os?/gi)
  ];
  const years = matches.map((match) => Number(match[1])).filter((value) => value > 0 && value < 60);
  return years.length ? Math.max(...years) : null;
}

function extractLanguageEvidence(text: string) {
  const levels = /\b(?:nativo|biling[uü]e|avanzado|intermedio|b[aá]sico|first certificate|proficiency|b1|b2|c1|c2)\b/i;
  return LANGUAGE_RULES.flatMap((rule) => {
    const match = rule.pattern.exec(text);
    if (!match || match.index == null) return [];
    const context = text.slice(Math.max(0, match.index - 45), Math.min(text.length, match.index + match[0].length + 75));
    const level = context.match(levels)?.[0] ?? null;
    return [{ lang: rule.label, level: level ? cleanLine(level).toLowerCase() : null, evidence: readableLine(context) || cleanLine(match[0]) }];
  });
}

function sectionHighlights(text: string, heading: RegExp, stop: RegExp) {
  const lines = text.split(/\r?\n+/).map(readableLine).filter(Boolean);
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return [];
  const selected: string[] = [];
  for (const line of lines.slice(start + 1, start + 13)) {
    if (stop.test(line)) break;
    if (/referencias?|contacto|tel[eé]fono|celular/i.test(line)) continue;
    if (/\b(?:19|20)\d{2}\b|actualidad|presente|empresa|cargo|puesto|tareas|responsable|auxiliar|analista|vendedor|administrativ|operari/i.test(line)) selected.push(line);
    if (selected.length >= 4) break;
  }
  return unique(selected);
}

function fallbackHighlights(text: string, pattern: RegExp) {
  return unique(text
    .split(/(?<=[.;])\s+|\r?\n+/)
    .map(readableLine)
    .filter((line) => line && pattern.test(line) && !/referencias?|contacto/i.test(line)))
    .slice(0, 3);
}

function explicitEducationHighlights(text: string) {
  const patterns = [
    /\b(?:egresad[oa]|graduad[oa]|estudiante)\s+(?:de|en)\s+[^.;\n]{3,110}/gi,
    /\b(?:licenciatura|tecnicatura|bachillerato|posgrado|maestr[ií]a|curso)\s+(?:de|en)\s+[^.;\n]{3,110}/gi,
    /\b(?:universidad|facultad|instituto)\s+[^.;\n]{3,110}/gi
  ];
  const matches = unique(patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => readableLine(match[0]))))
    .sort((a, b) => b.length - a.length);
  return matches.filter((value, index) => !matches.slice(0, index).some((longer) => normalize(longer).includes(normalize(value)))).slice(0, 3);
}

export function analyzeCvText(input: string): CvAnalysis {
  const text = String(input ?? "").replace(/\u0000/g, " ").replace(/\r/g, "\n");
  const compact = text.replace(/\s+/g, " ").trim();
  const letterCount = (compact.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) ?? []).length;
  const technicalSignals = (compact.match(/%PDF-|endobj|xref|\/FlateDecode|\/XObject/g) ?? []).length;
  const hasReadableText = compact.length >= 80 && letterCount / Math.max(1, compact.length) >= 0.55 && technicalSignals < 5;
  if (!hasReadableText) {
    return { hasReadableText: false, summary: null, primaryRole: null, roles: [], skills: [], languages: [], years: null, city: null, country: null, experienceHighlights: [], educationHighlights: [], confidence: "baja", warning: "El archivo existe, pero no tiene texto suficiente para analizarlo con confianza." };
  }

  const referenceCut = compact.search(/\b(?:referencias laborales|referencias personales)\b/i);
  const mainText = referenceCut > 0 ? compact.slice(0, referenceCut) : compact;
  const roles = unique(labelsFor(mainText, ROLE_RULES));
  const primaryRole = primaryRoleFor(mainText);
  const skills = unique(labelsFor(mainText, SKILL_RULES));
  const languages = extractLanguageEvidence(mainText);
  const years = extractYears(mainText);
  const residence = extractCvResidence(mainText);
  const city = residence?.city ?? null;
  const country = residence?.country ?? (/\buruguay\b/i.test(mainText) ? "Uruguay" : null);
  const experienceHighlights = sectionHighlights(text, /experiencia|trayectoria|antecedentes laborales/i, /educaci[oó]n|formaci[oó]n|estudios|idiomas|habilidades/i);
  const educationHighlights = sectionHighlights(text, /educaci[oó]n|formaci[oó]n|estudios/i, /experiencia|idiomas|habilidades|referencias/i);
  const safeExperience = experienceHighlights.length ? experienceHighlights : fallbackHighlights(mainText, /experiencia|trabaj[eéoa]|desempe[nñ]|responsable|cargo|puesto|empresa/i);
  const explicitEducation = explicitEducationHighlights(text);
  const safeEducation = educationHighlights.length ? educationHighlights : explicitEducation;

  const facts = [
    roles.length ? `Áreas mencionadas en el CV: ${roles.join(", ")}.` : "",
    years ? `Experiencia declarada: ${years} años.` : "",
    languages.length ? `Idiomas mencionados: ${languages.map((item) => `${item.lang}${item.level ? ` (${item.level})` : ""}`).join(", ")}.` : "",
    city ? `Ubicación mencionada: ${city}, Uruguay.` : "",
    safeEducation[0] ? `Formación mencionada: ${safeEducation[0]}` : ""
  ].filter(Boolean);
  const evidenceCount = roles.length + skills.length + languages.length + (years ? 1 : 0) + (city ? 1 : 0) + safeExperience.length + safeEducation.length;
  const confidence = evidenceCount >= 7 ? "alta" : evidenceCount >= 3 ? "media" : "baja";

  return {
    hasReadableText,
    summary: facts.length ? facts.join("\n") : "CV disponible, sin suficientes datos estructurados para generar un resumen confiable.",
    primaryRole,
    roles,
    skills,
    languages,
    years,
    city,
    country,
    experienceHighlights: safeExperience,
    educationHighlights: safeEducation,
    confidence,
    warning: confidence === "baja" ? "Hay pocos datos legibles. Conviene revisar el CV original." : null
  };
}

export function evidenceForRule(text: string, pattern: RegExp) {
  return evidenceAround(text, pattern);
}
