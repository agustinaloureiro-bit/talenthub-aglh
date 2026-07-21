import type { InterpretedTalentQuery, TalentCandidateResult } from "./types.js";

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
  "trabajo en equipo": ["colaboracion", "colaborativo", "equipos multidisciplinarios"]
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
    (candidate.tags ?? []).join(" ")
  ].join(" ");
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
  const values = [...interpreted.roles, ...interpreted.skills, ...interpreted.languages, ...interpreted.industries];
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
  const matchedConcepts = concepts.filter((concept) => conceptMatchesText(haystack, interpreted, concept));
  return { required: concepts.length, matched: matchedConcepts.length, ratio: concepts.length ? matchedConcepts.length / concepts.length : 1, concepts, matchedConcepts };
}

function satisfiesRequiredGroups(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  if (!interpreted.requiredGroups.length) return true;
  if (isAmbulanceDriverQuery(interpreted)) return hasAmbulanceDriverEvidence(candidate);
  const haystack = candidateHaystack(candidate);
  return interpreted.requiredGroups.every((group) => includesAny(haystack, group));
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
  if (interpreted.seniority && normalizeSearchValue(haystack).includes(normalizeSearchValue(interpreted.seniority))) reasons.push("seniority compatible");
  const matched = resultCoverage.matchedConcepts.length ? resultCoverage.matchedConcepts.join(", ") : "coincidencia textual parcial";
  const evidence = evidenceConcepts.length ? " Evidencia encontrada en el CV." : " La coincidencia proviene de los datos indexados; conviene revisar el CV.";
  return `Coincide con: ${matched}.${reasons.length ? ` ${reasons.join(", ")}.` : ""}${evidence}`;
}

export function rerankCandidates(candidates: TalentCandidateResult[], interpreted: InterpretedTalentQuery) {
  return candidates
    .filter((candidate) => isCredibleCandidateName(candidate.fullName))
    .filter((candidate) => satisfiesRequiredGroups(candidate, interpreted))
    .map((candidate) => {
      const conceptCoverage = coverage(candidate, interpreted);
      const documentText = candidate.documentSnippet ?? "";
      const documentMatches = conceptCoverage.concepts.filter((concept) => conceptMatchesText(documentText, interpreted, concept)).length;
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
