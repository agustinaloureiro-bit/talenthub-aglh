import { interpretTalentQuery } from "./queryInterpreter.js";
import { rerankCandidates } from "./candidateRanker.js";
import type { TalentCandidateResult, TalentSearchFilters, TalentSearchResult } from "./types.js";

export type CandidateSearchProvider = (query: string, filters?: TalentSearchFilters) => Promise<TalentCandidateResult[]>;

export class RecruitmentIntelligenceEngine {
  constructor(private readonly fallbackSearch: CandidateSearchProvider) {}

  async search(query: string, filters: TalentSearchFilters = {}): Promise<TalentSearchResult> {
    const interpreted = interpretTalentQuery(query);
    const candidates = await this.fallbackSearch(interpreted.normalizedQuery, filters);
    const ranked = rerankCandidates(candidates, interpreted).slice(0, 20);

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
