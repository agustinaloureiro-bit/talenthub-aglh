import type { InterpretedTalentQuery, TalentCandidateResult } from "./types.js";

function normalizeSearchValue(value: string) {
  return value.toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const EQUIVALENT_TERMS: Record<string, string[]> = {
  abogado: ["abogada", "legal", "derecho", "juridico", "asesor legal", "asesora legal"],
  abogada: ["abogado", "legal", "derecho", "juridico", "asesor legal", "asesora legal"],
  legal: ["abogado", "abogada", "derecho", "juridico"],
  ingles: ["english", "idioma ingles", "nivel ingles"],
  english: ["ingles", "idioma ingles"],
  ventas: ["vendedor", "vendedora", "comercial", "ejecutivo comercial", "ejecutiva comercial"],
  gastronomia: ["gastonomia", "restaurante", "cocina", "mozo", "moza", "atencion al cliente"],
  gastonomia: ["gastronomia", "restaurante", "cocina", "mozo", "moza"],
  logistica: ["logistica y produccion", "logistica y produccion", "deposito", "almacen"],
  seleccion: ["reclutamiento", "recursos humanos", "rrhh"]
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
  return interpreted.roles.length === 0 || includesAny(candidate.currentRole ?? "", interpreted.roles);
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

function coverage(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  const haystack = candidateHaystack(candidate);
  const concepts = requestedConcepts(interpreted);
  const matchedConcepts = concepts.filter((concept) => includesAny(haystack, [concept]));
  return { required: concepts.length, matched: matchedConcepts.length, ratio: concepts.length ? matchedConcepts.length / concepts.length : 1, concepts, matchedConcepts };
}

export function explainCandidateMatch(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  const haystack = candidateHaystack(candidate);
  const profileText = candidateProfileText(candidate);
  const resultCoverage = coverage(candidate, interpreted);
  const evidenceText = candidate.documentSnippet ?? "";
  const evidenceConcepts = resultCoverage.concepts.filter((concept) => includesAny(evidenceText, [concept]));
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
    .map((candidate) => {
      const conceptCoverage = coverage(candidate, interpreted);
      const documentText = candidate.documentSnippet ?? "";
      const documentMatches = conceptCoverage.concepts.filter((concept) => includesAny(documentText, [concept])).length;
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
      const score = interpreted.roles.length > 0 && !primaryRoleMatches(candidate, interpreted)
        ? Math.min(89, rawScore)
        : rawScore;
      return {
        ...candidate,
        score,
        matchReason: explainCandidateMatch({ ...candidate, score }, interpreted),
        matchCoverage: conceptCoverage,
        primaryRoleAligned: primaryRoleMatches(candidate, interpreted)
      };
    })
    .sort((a, b) => (b.matchCoverage?.ratio ?? 0) - (a.matchCoverage?.ratio ?? 0)
      || Number(b.primaryRoleAligned) - Number(a.primaryRoleAligned)
      || b.score - a.score
      || b.qualityScore - a.qualityScore)
    .map(({ matchCoverage, primaryRoleAligned, ...candidate }) => candidate);
}
