import type { InterpretedTalentQuery, TalentCandidateResult } from "./types.js";

function includesAny(text: string, values: string[]) {
  return values.some((value) => {
    const normalized = value.toLowerCase();
    if (text.includes(normalized)) return true;
    if (/[oa]$/.test(normalized)) return text.includes(`${normalized.slice(0, -1)}a`) || text.includes(`${normalized.slice(0, -1)}o`);
    return false;
  });
}

export function explainCandidateMatch(candidate: TalentCandidateResult, interpreted: InterpretedTalentQuery) {
  const haystack = `${candidate.fullName} ${candidate.currentRole ?? ""} ${candidate.city ?? ""} ${candidate.country ?? ""} ${(candidate.tags ?? []).join(" ")} ${candidate.seniority ?? ""} ${candidate.primaryDocumentName ?? ""} ${candidate.documentSnippet ?? ""}`.toLowerCase();
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
      const haystack = `${candidate.fullName} ${candidate.currentRole ?? ""} ${candidate.city ?? ""} ${candidate.country ?? ""} ${(candidate.tags ?? []).join(" ")} ${candidate.seniority ?? ""} ${candidate.primaryDocumentName ?? ""} ${candidate.documentSnippet ?? ""}`.toLowerCase();
      let intelligenceBoost = 0;
      for (const role of interpreted.roles) if (includesAny(haystack, [role])) intelligenceBoost += 18;
      for (const skill of interpreted.skills) if (haystack.includes(skill.toLowerCase())) intelligenceBoost += 10;
      for (const language of interpreted.languages) if (includesAny(haystack, [language])) intelligenceBoost += 12;
      if (interpreted.seniority && haystack.includes(interpreted.seniority.toLowerCase())) intelligenceBoost += 8;
      if ((candidate.documentCount ?? 0) > 0) intelligenceBoost += 6;

      const score = Math.min(100, Math.max(0, Math.round((candidate.score ?? 0) * 0.7 + intelligenceBoost + candidate.qualityScore * 0.15)));
      return { ...candidate, score, matchReason: explainCandidateMatch({ ...candidate, score }, interpreted) };
    })
    .sort((a, b) => b.score - a.score || b.qualityScore - a.qualityScore);
}
