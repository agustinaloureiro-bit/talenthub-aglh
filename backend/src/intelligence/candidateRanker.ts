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

function coverage(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  const haystack = candidateHaystack(candidate);
  const checks = [
    interpreted.roles.length ? includesAny(haystack, interpreted.roles) : true,
    interpreted.skills.length ? includesAny(haystack, interpreted.skills) : true,
    interpreted.languages.length ? includesAny(haystack, interpreted.languages) : true,
    interpreted.industries.length ? includesAny(haystack, interpreted.industries) : true
  ];
  const required = checks.filter((_, index) => [interpreted.roles, interpreted.skills, interpreted.languages, interpreted.industries][index].length).length;
  const matched = checks.filter(Boolean).length - (4 - required);
  return { required, matched, ratio: required ? matched / required : 1 };
}

export function explainCandidateMatch(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  const haystack = candidateHaystack(candidate);
  const reasons: string[] = [];

  if (interpreted.roles.length && includesAny(haystack, interpreted.roles)) reasons.push("rol alineado con la busqueda");
  if (interpreted.skills.length && includesAny(haystack, interpreted.skills)) reasons.push("menciona competencias relevantes");
  if (interpreted.languages.length && includesAny(haystack, interpreted.languages)) reasons.push("coincide con idioma solicitado");
  if ((candidate.documentCount ?? 0) > 0) reasons.push("tiene CV/documentos disponibles");
  if (interpreted.seniority && haystack.includes(interpreted.seniority.toLowerCase())) reasons.push("seniority compatible");
  if (candidate.qualityScore >= 70) reasons.push("perfil con buena calidad de datos");

  return reasons.length ? `Recomendado por ${reasons.join(", ")}.` : "Resultado relacionado por texto disponible; falta enriquecer CV para una explicacion mas precisa.";
}

export function rerankCandidates(candidates: TalentCandidateResult[], interpreted: InterpretedTalentQuery) {
  return candidates
    .map((candidate) => {
      const haystack = candidateHaystack(candidate);
      const conceptCoverage = coverage(candidate, interpreted);
      let intelligenceBoost = 0;
      for (const role of interpreted.roles) if (includesAny(haystack, [role])) intelligenceBoost += 18;
      for (const skill of interpreted.skills) if (includesAny(haystack, [skill])) intelligenceBoost += 10;
      for (const language of interpreted.languages) if (includesAny(haystack, [language])) intelligenceBoost += 12;
      for (const industry of interpreted.industries) if (includesAny(haystack, [industry])) intelligenceBoost += 8;
      if (interpreted.seniority && normalizeSearchValue(haystack).includes(normalizeSearchValue(interpreted.seniority))) intelligenceBoost += 8;
      if ((candidate.documentCount ?? 0) > 0) intelligenceBoost += 6;
      if (conceptCoverage.required > 1 && conceptCoverage.ratio < 0.5) intelligenceBoost -= 20;
      if (conceptCoverage.required > 0 && conceptCoverage.ratio === 1) intelligenceBoost += 15;

      const score = Math.min(100, Math.max(0, Math.round((candidate.score ?? 0) * 0.7 + intelligenceBoost + candidate.qualityScore * 0.15)));
      return { ...candidate, score, matchReason: explainCandidateMatch({ ...candidate, score }, interpreted), matchCoverage: conceptCoverage };
    })
    .sort((a, b) => (b.matchCoverage?.ratio ?? 0) - (a.matchCoverage?.ratio ?? 0) || b.score - a.score || b.qualityScore - a.qualityScore)
    .map(({ matchCoverage, ...candidate }) => candidate);
}
