import { interpretTalentQuery } from "./queryInterpreter.js";
import { rerankCandidates } from "./candidateRanker.js";
import type { TalentCandidateResult, TalentSearchFilters, TalentSearchResult } from "./types.js";

export type CandidateSearchProvider = (query: string, filters?: TalentSearchFilters) => Promise<TalentCandidateResult[]>;

export class RecruitmentIntelligenceEngine {
  constructor(private readonly fallbackSearch: CandidateSearchProvider) {}

  async search(query: string, filters: TalentSearchFilters = {}): Promise<TalentSearchResult> {
    const interpreted = interpretTalentQuery(query);
    const retrievalQuery = [...new Set([
      interpreted.normalizedQuery,
      ...interpreted.roles,
      ...interpreted.skills,
      ...interpreted.languages,
      ...interpreted.industries
    ].filter(Boolean))].join(" ");
    const candidates = await this.fallbackSearch(retrievalQuery, filters);
    const ranked = rerankCandidates(candidates, interpreted);

    return {
      query: interpreted,
      data: ranked,
      explanation: ranked.length
        ? `Analice la busqueda, detecte ${interpreted.mustHave.length || "sin"} criterios fuertes y ordene los perfiles disponibles por compatibilidad.`
        : "No encontre perfiles compatibles en el indice actual. Conviene sincronizar fuentes o cargar CVs.",
      mode: "intelligence_fallback"
    };
  }
}
