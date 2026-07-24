import { interpretTalentQuery } from "./queryInterpreter.js";
import { rerankCandidates } from "./candidateRanker.js";
import type { TalentCandidateResult, TalentSearchFilters, TalentSearchResult } from "./types.js";

export type CandidateSearchProvider = (query: string, filters?: TalentSearchFilters) => Promise<TalentCandidateResult[]>;

function retrievalSignals(query: string) {
  const ignoredWords = new Set([
    "busco", "buscar", "buscando", "estoy", "necesito", "preciso", "persona", "alguien",
    "perfil", "candidato", "candidata", "con", "sin", "para", "experiencia", "experiencias",
    "tener", "tenga", "que", "una", "uno", "trabajar", "necesita", "necesitan", "requiere",
    "requieren", "especifica", "especifico", "sean", "alrededores", "hombre", "hombres",
    "mujer", "mujeres"
  ]);
  return query
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => word.length >= 2 && !ignoredWords.has(word.toLowerCase()))
    .join(" ");
}

export class RecruitmentIntelligenceEngine {
  constructor(private readonly fallbackSearch: CandidateSearchProvider) {}

  async search(query: string, filters: TalentSearchFilters = {}): Promise<TalentSearchResult> {
    const interpreted = interpretTalentQuery(query);
    const understoodConcepts = [
      ...interpreted.roles,
      ...interpreted.skills,
      ...interpreted.languages,
      ...interpreted.industries,
      ...interpreted.locations
    ].filter(Boolean);
    const retrievalQuery = [...new Set([
      retrievalSignals(interpreted.normalizedQuery),
      ...understoodConcepts
    ].filter(Boolean))].join(" ");
    const candidates = await this.fallbackSearch(retrievalQuery, filters);
    let ranked = rerankCandidates(candidates, interpreted)
      .filter((candidate) => candidate.score >= (filters.minScore ?? 0));
    if (filters.sort === "recent") {
      ranked = ranked.sort((a, b) => {
        const left = a.latestSourceAt ? Date.parse(a.latestSourceAt) : 0;
        const right = b.latestSourceAt ? Date.parse(b.latestSourceAt) : 0;
        return right - left || b.score - a.score;
      });
    }

    return {
      query: interpreted,
      data: ranked,
      explanation: ranked.length
        ? `Analice la busqueda, detecte ${interpreted.mustHave.length || "sin"} criterios laborales fuertes y ordene los perfiles disponibles por compatibilidad.${interpreted.ignoredCriteria.length ? " Los criterios personales sensibles no se utilizaron." : ""}`
        : "No encontre perfiles compatibles en el indice actual. Conviene sincronizar fuentes o cargar CVs.",
      mode: "intelligence_fallback"
    };
  }
}
