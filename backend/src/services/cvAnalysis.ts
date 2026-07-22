export type CvLanguageEvidence = {
  lang: string;
  level: string | null;
  evidence: string;
};

export type CvAnalysis = {
  hasReadableText: boolean;
  summary: string | null;
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
  { label: "abogado", pattern: /\b(?:abogad[oa]|asesor(?:a)? legal|derecho (?:laboral|corporativo|civil|penal)|jur[ií]dic[oa])\b/i },
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
  { label: "liderazgo", pattern: /\b(?:liderazgo|supervisi[oó]n de equipo|jefatura)\b/i },
  { label: "negociacion", pattern: /\bnegociaci[oó]n\b/i }
];

const LANGUAGE_RULES: EvidenceRule[] = [
  { label: "ingles", pattern: /\b(?:ingl[eé]s|english)\b/i },
  { label: "portugues", pattern: /\b(?:portugu[eé]s|portuguese)\b/i },
  { label: "frances", pattern: /\b(?:franc[eé]s|french)\b/i },
  { label: "italiano", pattern: /\bitaliano\b/i }
];

const URUGUAY_LOCATIONS = [
  "Ciudad de la Costa", "San Jose de Carrasco", "Barra de Carrasco", "Shangri La", "Shangrila",
  "Solymar", "Lagomar", "El Pinar",
  "Montevideo", "Canelones", "Maldonado", "San Jose", "Colonia", "Florida", "Rocha", "Paysandu",
  "Salto", "Rivera", "Tacuarembo", "Durazno", "Soriano", "Lavalleja", "Artigas", "Cerro Largo",
  "Flores", "Rio Negro", "Treinta y Tres", "Las Piedras", "Ciudad de la Costa", "Pando"
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

export function extractCvResidence(input: string) {
  const compact = String(input ?? "").replace(/\u0000/g, " ").replace(/\s+/g, " ").trim();
  if (!compact) return null;
  const personalMarker = /\b(?:datos personales|informaci[oó]n personal|domicilio|direcci[oó]n|lugar de residencia|residencia\s*:|radicad[oa] en|vive en)\b/i.exec(compact);
  if (!personalMarker || personalMarker.index == null) return null;
  const afterMarker = compact.slice(personalMarker.index, personalMarker.index + 1_400);
  const markerOffset = personalMarker[0].length + 20;
  const stop = /\b(?:web\s*&\s*redes|conocimientos|experiencia laboral|trayectoria|estudios b[aá]sicos|educaci[oó]n|formaci[oó]n)\b/i.exec(afterMarker.slice(markerOffset));
  const segment = stop?.index == null ? afterMarker : afterMarker.slice(0, markerOffset + stop.index);
  const city = earliestKnownLocation(segment);
  if (!city) return null;
  return { city, country: /\buruguay\b/i.test(segment) ? "Uruguay" : null };
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
    return { hasReadableText: false, summary: null, roles: [], skills: [], languages: [], years: null, city: null, country: null, experienceHighlights: [], educationHighlights: [], confidence: "baja", warning: "El archivo existe, pero no tiene texto suficiente para analizarlo con confianza." };
  }

  const referenceCut = compact.search(/\b(?:referencias laborales|referencias personales)\b/i);
  const mainText = referenceCut > 0 ? compact.slice(0, referenceCut) : compact;
  const roles = unique(labelsFor(mainText, ROLE_RULES));
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
