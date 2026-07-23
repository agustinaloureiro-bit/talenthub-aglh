import type { InterpretedTalentQuery, TalentCandidateResult } from "./types.js";
import { extractCvResidence } from "../services/cvAnalysis.js";
import { evaluateUruguayProximity, findUruguayPlace, normalizePlaceName } from "./uruguayGeography.js";

function normalizeSearchValue(value: string) {
  return value.toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isCredibleCandidateName(value: string) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 4 || name.length > 90 || /[@\d]|https?:|www\.|:/.test(name)) return false;
  const words = name.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 8) return false;
  if (!words.every((word) => /^[\p{L}'-]+$/u.test(word))) return false;
  return !/(sin t[ií]tulo|sin nombre|preparaci[oó]n|entrega de|[oó]rdenes|experiencia en|responsable de|tareas de|funciones|perfil profesional|objetivo laboral|curr[ií]culum|curriculum vitae|postulaci[oó]n|futuras vacantes)/i.test(name);
}

const EQUIVALENT_TERMS: Record<string, string[]> = {
  "auxiliar administrativo": ["administrativo", "administrativa", "asistente administrativo", "asistente administrativa", "back office"],
  "chofer de ambulancia": ["conductor de ambulancia", "ambulanciero", "traslado de pacientes", "emergencia movil"],
  "conductor de ambulancia": ["chofer de ambulancia", "ambulanciero", "traslado de pacientes", "emergencia movil"],
  ambulanciero: ["chofer de ambulancia", "conductor de ambulancia", "traslado de pacientes"],
  chofer: ["conductor", "driver"],
  conductor: ["chofer", "driver"],
  ambulancia: ["emergencia movil", "emergencia medica", "traslado de pacientes"],
  abogado: ["abogada", "legal", "derecho", "juridico", "asesor legal", "asesora legal"],
  abogada: ["abogado", "legal", "derecho", "juridico", "asesor legal", "asesora legal"],
  legal: ["abogado", "abogada", "derecho", "juridico"],
  ingles: ["english", "idioma ingles", "nivel ingles"],
  english: ["ingles", "idioma ingles"],
  ventas: ["vendedor", "vendedora", "comercial", "ejecutivo comercial", "ejecutiva comercial"],
  gastronomia: ["gastonomia", "restaurante", "cocina", "mozo", "moza", "atencion al cliente"],
  gastonomia: ["gastronomia", "restaurante", "cocina", "mozo", "moza"],
  logistica: ["logistica y produccion", "logistica y produccion", "deposito", "almacen"],
  seleccion: ["reclutamiento", "recursos humanos", "rrhh"],
  liderazgo: ["lider", "jefe", "supervisor", "coordinador", "encargado", "gerente", "team leader", "manejo de equipos", "personal a cargo"],
  organizacion: ["organizacion", "planificacion", "coordinacion", "gestion del tiempo", "seguimiento"],
  comunicacion: ["comunicacion", "trato con clientes", "atencion al cliente", "relaciones interpersonales"],
  negociacion: ["negociacion", "cierre de ventas", "manejo de cuentas", "desarrollo de clientes"],
  "resolucion de problemas": ["resolver problemas", "analitico", "pensamiento critico", "toma de decisiones"],
  adaptabilidad: ["flexibilidad", "entorno dinamico", "trabajo bajo presion"],
  "trabajo en equipo": ["colaboracion", "colaborativo", "equipos multidisciplinarios"],
  supermercado: ["retail", "cajero", "cajera", "repositor", "repositora", "operario", "operaria", "auxiliar", "deposito", "stock", "atencion al cliente"],
  operario: ["operaria", "operador", "operadora", "produccion", "manufactura", "linea de produccion", "auxiliar de produccion", "peon", "maquinista", "envasado", "empaque"],
  operaria: ["operario", "operador", "operadora", "produccion", "manufactura", "linea de produccion", "auxiliar de produccion", "peon", "maquinista", "envasado", "empaque"],
  operador: ["operario", "operaria", "operadora", "produccion", "manufactura", "maquinista", "linea de produccion"],
  operadora: ["operario", "operaria", "operador", "produccion", "manufactura", "maquinista", "linea de produccion"],
  fabrica: ["produccion", "manufactura", "industria", "linea de produccion", "planta industrial", "envasado", "empaque", "control de calidad"],
  "ciudad de la costa": ["solymar", "lagomar", "el pinar", "lomas de solymar", "medanos de solymar", "shangrila", "shangri la", "san jose de carrasco", "barra de carrasco"]
};

function equivalentValues(value: string) {
  const normalized = normalizeSearchValue(value);
  return [normalized, ...(EQUIVALENT_TERMS[normalized] ?? [])].map(normalizeSearchValue);
}

function includesAny(text: string, values: string[]) {
  const normalizedText = normalizeSearchValue(text);
  return values.some((value) => {
    const variants = equivalentValues(value);
    if (variants.some((variant) => normalizedText.includes(variant))) return true;
    const normalized = normalizeSearchValue(value);
    if (/[oa]$/.test(normalized)) return normalizedText.includes(`${normalized.slice(0, -1)}a`) || normalizedText.includes(`${normalized.slice(0, -1)}o`);
    return false;
  });
}

function candidateHaystack(candidate: TalentCandidateResult) {
  return [
    candidate.fullName,
    candidate.currentRole ?? "",
    candidate.city ?? "",
    candidate.country ?? "",
    candidate.summary ?? "",
    (candidate.email ?? []).join(" "),
    (candidate.phone ?? []).join(" "),
    (candidate.tags ?? []).join(" "),
    candidate.seniority ?? "",
    candidate.primaryDocumentName ?? "",
    candidate.documentSnippet ?? ""
  ].join(" ");
}

function candidateProfileText(candidate: TalentCandidateResult) {
  return [
    candidate.currentRole ?? "",
    (candidate.tags ?? []).join(" "),
    candidate.city ?? "",
    candidate.country ?? ""
  ].join(" ");
}

function recencyBonus(value?: string | null) {
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  if (ageDays <= 7) return 10;
  if (ageDays <= 30) return 7;
  if (ageDays <= 90) return 4;
  if (ageDays <= 365) return 2;
  return 0;
}

function primaryRoleMatches(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  const requestedAreas = [...interpreted.roles, ...interpreted.skills, ...interpreted.industries];
  return requestedAreas.length === 0 || includesAny(candidate.currentRole ?? "", requestedAreas);
}

function conceptMatchesProfile(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery, concept: string) {
  if (interpreted.roles.some((role) => normalizeSearchValue(role) === normalizeSearchValue(concept))) {
    return includesAny(candidate.currentRole ?? "", [concept]);
  }
  return includesAny(candidateProfileText(candidate), [concept]);
}

function requestedConcepts(interpreted: InterpretedTalentQuery) {
  const values = [...interpreted.roles, ...interpreted.skills, ...interpreted.languages, ...interpreted.industries, ...interpreted.locations];
  const byNormalized = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeSearchValue(value);
    if (normalized && !byNormalized.has(normalized)) byNormalized.set(normalized, value);
  }
  return [...byNormalized.values()];
}

function conceptMatchesText(text: string, interpreted: InterpretedTalentQuery, concept: string) {
  const isSpecializedRole = interpreted.requiredGroups.length > 1
    && interpreted.roles.some((role) => normalizeSearchValue(role) === normalizeSearchValue(concept));
  if (isSpecializedRole) return interpreted.requiredGroups.every((group) => includesAny(text, group));
  return includesAny(text, [concept]);
}

function isAmbulanceDriverQuery(interpreted: InterpretedTalentQuery) {
  return interpreted.roles.some((role) => ["chofer de ambulancia", "conductor de ambulancia", "ambulanciero"]
    .includes(normalizeSearchValue(role)));
}

function hasAmbulanceDriverEvidence(candidate: TalentCandidateResult) {
  const role = normalizeSearchValue(candidate.currentRole ?? "");
  if (/\b(?:chofer|conductor)\s+de\s+ambulancia\b|\bambulanciero\b/.test(role)) return true;

  const evidence = normalizeSearchValue([
    candidate.summary ?? "",
    candidate.documentSnippet ?? ""
  ].join(" "));
  if (/\b(?:chofer|conductor)\s+de\s+ambulancia\b|\bambulanciero\b/.test(evidence)) return true;

  const driver = "(?:chofer|conductor|driver|manejo|conduccion)";
  const medicalTransport = "(?:ambulancia|emergencia (?:movil|medica)|traslado de pacientes|transporte de pacientes)";
  const nearby = new RegExp(`\\b${driver}\\b.{0,100}\\b${medicalTransport}\\b|\\b${medicalTransport}\\b.{0,100}\\b${driver}\\b`);
  if (nearby.test(evidence)) return true;

  return includesAny(role, ["chofer", "conductor"])
    && /\b(?:traslado|transporte) de pacientes\b|\bambulancia\b|\bemergencia (?:movil|medica)\b/.test(evidence);
}

function coverage(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  const haystack = candidateHaystack(candidate);
  const concepts = requestedConcepts(interpreted);
  const requestedLocations = new Set(interpreted.locations.map(normalizeSearchValue));
  const locationMatch = candidateLocationMatch(candidate, interpreted);
  const matchedConcepts = concepts.filter((concept) => {
    if (!requestedLocations.has(normalizeSearchValue(concept))) {
      return conceptMatchesText(haystack, interpreted, concept);
    }
    return locationMatch.matches && !["unknown", "broad"].includes(locationMatch.confidence);
  });
  return { required: concepts.length, matched: matchedConcepts.length, ratio: concepts.length ? matchedConcepts.length / concepts.length : 1, concepts, matchedConcepts };
}

const FACTORY_OPERATION_ROLE_PATTERN = /\b(?:operari[oa]|operador(?:a)?|auxiliar de producci[oó]n|pe[oó]n|maquinista|producci[oó]n|manufactura|l[ií]nea de producci[oó]n|envasad[oa]|empaquetad[oa]|armador(?:a)?|control de calidad)\b/i;
const EXPLICIT_FACTORY_EXPERIENCE_PATTERN = /\b(?:operari[oa]|operador(?:a)?|auxiliar de producci[oó]n|pe[oó]n|maquinista|l[ií]nea de producci[oó]n|envasad[oa]|empaquetad[oa]|armador(?:a)?|control de calidad|manejo de maquinarias?|operaci[oó]n de maquinarias?)\b/i;
const CLEARLY_NON_OPERATIONAL_ROLE_PATTERN = /\b(?:administrativ[oa]|contador(?:a)?|abogad[oa]|ingenier[oa]|arquitect[oa]|psic[oó]log[oa]|recursos humanos|marketing|comercial|ventas|secretari[oa])\b/i;

function hasFactoryOperationsRoleEvidence(candidate: TalentCandidateResult) {
  const currentRole = candidate.currentRole ?? "";
  if (!CLEARLY_NON_OPERATIONAL_ROLE_PATTERN.test(currentRole) && FACTORY_OPERATION_ROLE_PATTERN.test(currentRole)) return true;
  const cvEvidence = [candidate.summary ?? "", candidate.documentSnippet ?? ""].join(" ");
  if (EXPLICIT_FACTORY_EXPERIENCE_PATTERN.test(cvEvidence)) return true;
  return !currentRole.trim() && FACTORY_OPERATION_ROLE_PATTERN.test((candidate.tags ?? []).join(" "));
}

function satisfiesRequiredGroups(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  if (!interpreted.requiredGroups.length) return true;
  if (isAmbulanceDriverQuery(interpreted)) return hasAmbulanceDriverEvidence(candidate);
  const requiresOperationalRole = interpreted.roles
    .some((role) => ["operario", "operaria"].includes(normalizeSearchValue(role)));
  if (requiresOperationalRole && !hasFactoryOperationsRoleEvidence(candidate)) return false;
  const evidence = candidateHaystack(candidate);
  return interpreted.requiredGroups.every((group) => includesAny(evidence, group));
}

function candidateResidence(candidate: TalentCandidateResult) {
  const cvResidence = extractCvResidence(candidate.documentSnippet ?? "");
  const structuredResidence = [candidate.city ?? "", candidate.country ?? ""].join(" ").trim();
  if (!cvResidence) return structuredResidence;

  const cvResidenceText = [cvResidence.city, cvResidence.country].filter(Boolean).join(" ");
  const cvPlace = findUruguayPlace(cvResidenceText);
  const structuredPlace = findUruguayPlace(structuredResidence);
  const cvIsBroader = cvPlace
    && structuredPlace
    && cvPlace.department === structuredPlace.department
    && normalizePlaceName(cvPlace.name) === normalizePlaceName(cvPlace.department)
    && normalizePlaceName(structuredPlace.name) !== normalizePlaceName(cvPlace.name);
  return cvIsBroader ? structuredResidence : cvResidenceText;
}

function candidateLocationMatch(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  if (!interpreted.locations.length) return { matches: true, distanceKm: null, confidence: "not_requested" as const };
  const residence = candidateResidence(candidate);
  if (!residence) return { matches: true, distanceKm: null, confidence: "unknown" as const };

  for (const requestedLocation of interpreted.locations) {
    const proximity = evaluateUruguayProximity(residence, requestedLocation);
    if (proximity?.matches) return { matches: true, distanceKm: proximity.distanceKm, confidence: "nearby" as const };

    const candidatePlace = findUruguayPlace(residence);
    const requestedPlace = findUruguayPlace(requestedLocation);
    const candidateIsBroadMontevideo = candidatePlace
      && requestedPlace
      && normalizePlaceName(candidatePlace.name) === "montevideo"
      && candidatePlace.department === requestedPlace.department;
    if (candidateIsBroadMontevideo) {
      return { matches: true, distanceKm: null, confidence: "broad" as const };
    }
  }

  const fallbackMatch = interpreted.locationGroups
    .some((group) => includesAny(residence, group));
  if (fallbackMatch) return { matches: true, distanceKm: null, confidence: "text" as const };

  const knownResidence = findUruguayPlace(residence);
  const knownRequestedLocation = interpreted.locations.some((location) => findUruguayPlace(location));
  return knownResidence && knownRequestedLocation
    ? { matches: false, distanceKm: null, confidence: "incompatible" as const }
    : { matches: true, distanceKm: null, confidence: "unknown" as const };
}

const BASIC_WORK_PATTERN = /\b(?:operari[oa]|cajer[oa]|repositor[oa]|auxiliar|pe[oó]n|deposito|dep[oó]sito|stock|almac[eé]n|limpieza|atenci[oó]n al cliente|ventas|mozo|moza|cocina|producci[oó]n|log[ií]stica|supermercado|retail)\b/i;
const PROFESSIONAL_ROLE_PATTERN = /\b(?:contador(?:a)?|abogad[oa]|ingenier[oa]|arquitect[oa]|m[eé]dic[oa]|psic[oó]log[oa]|licenciad[oa]|director(?:a)?|gerente|consultor(?:a) senior)\b/i;

function basicProfileSuitability(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  if (interpreted.profileLevel !== "basic") return { allowed: true, bonus: 0 };
  const role = candidate.currentRole ?? "";
  const evidence = [role, (candidate.tags ?? []).join(" "), candidate.summary ?? "", candidate.documentSnippet ?? ""].join(" ");
  const operationalEvidence = BASIC_WORK_PATTERN.test(evidence);
  const clearlyProfessional = PROFESSIONAL_ROLE_PATTERN.test(role)
    || /\b(?:contador(?:a)?|abogad[oa]|ingenier[oa]|arquitect[oa]|m[eé]dic[oa])\s+(?:p[uú]blic[oa]|recibid[oa]|titulad[oa])\b/i.test(evidence);
  return { allowed: !clearlyProfessional, bonus: operationalEvidence ? 12 : 0 };
}

export function explainCandidateMatch(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  const haystack = candidateHaystack(candidate);
  const profileText = candidateProfileText(candidate);
  const resultCoverage = coverage(candidate, interpreted);
  const evidenceText = candidate.documentSnippet ?? "";
  const evidenceConcepts = resultCoverage.concepts.filter((concept) => conceptMatchesText(evidenceText, interpreted, concept));
  const reasons: string[] = [];
  if (interpreted.roles.length && primaryRoleMatches(candidate, interpreted)) reasons.push("área principal alineada");
  else if (interpreted.roles.length && includesAny(evidenceText, interpreted.roles)) reasons.push("el área aparece en el CV, pero no como perfil principal");
  if (interpreted.skills.length && includesAny(profileText, interpreted.skills)) reasons.push("competencias principales alineadas");
  else if (interpreted.skills.length && includesAny(evidenceText, interpreted.skills)) reasons.push("competencias mencionadas en el CV");
  if (interpreted.languages.length && includesAny(haystack, interpreted.languages)) reasons.push("idioma solicitado");
  const locationMatch = candidateLocationMatch(candidate, interpreted);
  if (interpreted.locations.length && locationMatch.matches) {
    if (locationMatch.distanceKm != null) reasons.push(`ubicación solicitada (a ${locationMatch.distanceKm} km)`);
    else if (locationMatch.confidence === "broad") reasons.push("vive en Montevideo, pero el barrio no está declarado");
    else if (locationMatch.confidence === "unknown") reasons.push("ubicación pendiente de verificar");
    else reasons.push("ubicación solicitada");
  }
  if (interpreted.seniority && normalizeSearchValue(haystack).includes(normalizeSearchValue(interpreted.seniority))) reasons.push("seniority compatible");
  const matched = resultCoverage.matchedConcepts.length ? resultCoverage.matchedConcepts.join(", ") : "coincidencia textual parcial";
  const evidence = evidenceConcepts.length ? " Evidencia encontrada en el CV." : " La coincidencia proviene de los datos indexados; conviene revisar el CV.";
  return `Coincide con: ${matched}.${reasons.length ? ` ${reasons.join(", ")}.` : ""}${evidence}`;
}

export function rerankCandidates(candidates: TalentCandidateResult[], interpreted: InterpretedTalentQuery) {
  return candidates
    .filter((candidate) => isCredibleCandidateName(candidate.fullName))
    .filter((candidate) => satisfiesRequiredGroups(candidate, interpreted))
    .filter((candidate) => candidateLocationMatch(candidate, interpreted).matches)
    .filter((candidate) => basicProfileSuitability(candidate, interpreted).allowed)
    .map((candidate) => {
      const locationMatch = candidateLocationMatch(candidate, interpreted);
      const conceptCoverage = coverage(candidate, interpreted);
      const documentText = candidate.documentSnippet ?? "";
      const requestedLocations = new Set(interpreted.locations.map(normalizeSearchValue));
      const documentMatches = conceptCoverage.concepts
        .filter((concept) => !requestedLocations.has(normalizeSearchValue(concept)))
        .filter((concept) => conceptMatchesText(documentText, interpreted, concept))
        .length;
      const documentRatio = conceptCoverage.required ? documentMatches / conceptCoverage.required : 0;
      const profileText = candidateProfileText(candidate);
      const profileMatches = conceptCoverage.concepts.filter((concept) => conceptMatchesProfile(candidate, interpreted, concept)).length;
      const profileRatio = conceptCoverage.required ? profileMatches / conceptCoverage.required : 0;
      const hasContact = Boolean(candidate.email?.length || candidate.phone?.length);
      const seniorityMatch = interpreted.seniority
        ? normalizeSearchValue(candidateHaystack(candidate)).includes(normalizeSearchValue(interpreted.seniority))
        : true;
      const rawScore = Math.min(100, Math.max(0, Math.round(
        conceptCoverage.ratio * 55
        + documentRatio * 25
        + profileRatio * 10
        + ((candidate.documentCount ?? 0) > 0 ? 5 : 0)
        + (hasContact ? 5 : 0)
        + (interpreted.seniority && seniorityMatch ? 5 : 0)
        + (locationMatch.distanceKm == null ? 0 : Math.max(0, 12 - locationMatch.distanceKm * 0.5))
        + (locationMatch.confidence === "broad" ? 2 : 0)
        - (locationMatch.confidence === "unknown" ? 5 : 0)
        + recencyBonus(candidate.latestSourceAt)
        + basicProfileSuitability(candidate, interpreted).bonus
      )));
      const primaryAligned = primaryRoleMatches(candidate, interpreted);
      const exactSpecializedRole = isAmbulanceDriverQuery(interpreted) && primaryAligned;
      const score = exactSpecializedRole
        ? Math.max(98, rawScore)
        : interpreted.roles.length > 0 && !primaryAligned
          ? Math.min(69, rawScore)
          : rawScore;
      return {
        ...candidate,
        matchDistanceKm: locationMatch.distanceKm,
        score,
        matchReason: explainCandidateMatch({ ...candidate, score }, interpreted),
        matchCoverage: conceptCoverage,
        primaryRoleAligned: primaryAligned
      };
    })
    .sort((a, b) => Number(b.primaryRoleAligned) - Number(a.primaryRoleAligned)
      || (b.matchCoverage?.ratio ?? 0) - (a.matchCoverage?.ratio ?? 0)
      || b.score - a.score
      || b.qualityScore - a.qualityScore)
    .map(({ matchCoverage, primaryRoleAligned, ...candidate }) => candidate);
}
