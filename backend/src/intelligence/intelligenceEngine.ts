import { interpretTalentQuery } from "./queryInterpreter.js";
import { rerankCandidates } from "./candidateRanker.js";
import type { TalentCandidateResult, TalentSearchFilters, TalentSearchResult } from "./types.js";

export type CandidateRetrievalPlan = {
  requiredGroups?: string[][];
};
export type CandidateSearchProvider = (
  query: string,
  filters?: TalentSearchFilters,
  plan?: CandidateRetrievalPlan
) => Promise<TalentCandidateResult[]>;

function retrievalSignals(query: string) {
  const profileQuery = query
    .replace(/^\s*(?:cliente|empresa|horarios?|jornada|periodo\s+de\s+trabajo|modalidad|valor\s+hora|salario|sueldo|remuneracion|remuneración)\s*:\s*.*$/gimu, " ");
  const ignoredWords = new Set([
    "busco", "buscar", "buscando", "estoy", "necesito", "preciso", "persona", "alguien",
    "perfil", "candidato", "candidata", "con", "sin", "para", "experiencia", "experiencias",
    "tener", "tenga", "que", "una", "uno", "trabajar", "necesita", "necesitan", "requiere",
    "requieren", "especifica", "especifico", "sean", "alrededores", "hombre", "hombres",
    "mujer", "mujeres", "tareas", "tarea", "implican", "responsable", "proceso", "controlando",
    "horario", "lunes", "martes", "miercoles", "miércoles", "jueves", "viernes", "sabado",
    "sábado", "domingo", "algun", "algún", "desde", "hasta", "remuneracion", "remuneración",
    "cliente", "empresa", "jornada", "periodo", "modalidad", "valor", "hora", "horas",
    "nominal", "salario", "sueldo", "convocatoria", "demanda", "partir",
    "responsabilidad", "responsabilidades", "garantizar", "correcto", "funcionamiento",
    "realizar", "efectuar", "ejecutar", "general", "generales", "diaria", "diarias",
    "registrar", "detectar", "reparar", "posible", "posibles", "requisito", "requisitos",
    "secundaria", "completa", "equivalente", "formacion", "formación", "deseable",
    "areas", "áreas", "afines", "minima", "mínima", "minimo", "mínimo", "anos", "años",
    "valora", "valorara", "valorará", "especialmente", "niveles", "consumos"
  ]);
  return profileQuery
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => word.length >= 3
      && !/^\d+(?:[.,:]\d+)?$/.test(word)
      && !ignoredWords.has(word.toLowerCase()));
}

function compactRetrievalQuery(query: string, understoodConcepts: string[]) {
  const normalizedConcepts = understoodConcepts
    .map((concept) => concept.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const conceptWords = new Set(
    normalizedConcepts.flatMap((concept) => retrievalSignals(concept).map((word) => word.toLowerCase()))
  );
  const residualSignals = retrievalSignals(query)
    .filter((word) => !conceptWords.has(word.toLowerCase()));
  const detailedDescription = retrievalSignals(query).length >= 12;
  const maxResidualSignals = detailedDescription ? 5 : 8;
  const maxConcepts = detailedDescription ? 10 : 12;

  return [...new Set([
    ...normalizedConcepts.slice(0, maxConcepts),
    ...residualSignals.slice(0, maxResidualSignals)
  ])].join(" ");
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
      ...interpreted.locations,
      ...interpreted.keywords
    ].filter(Boolean);
    const retrievalQuery = compactRetrievalQuery(interpreted.normalizedQuery, understoodConcepts);
    const candidates = await this.fallbackSearch(retrievalQuery, filters, {
      requiredGroups: interpreted.requiredGroups
    });
    let ranked = rerankCandidates(candidates, interpreted)
      .filter((candidate) => candidate.score >= (filters.minScore ?? 0));
    if (filters.sort === "recent") {
      ranked = ranked.sort((a, b) => {
        const left = a.latestSourceAt ? Date.parse(a.latestSourceAt) : 0;
        const right = b.latestSourceAt ? Date.parse(b.latestSourceAt) : 0;
        return right - left || b.score - a.score;
      });
    } else if (filters.sort === "oldest") {
      ranked = ranked.sort((a, b) => {
        const left = a.latestSourceAt ? Date.parse(a.latestSourceAt) : Number.POSITIVE_INFINITY;
        const right = b.latestSourceAt ? Date.parse(b.latestSourceAt) : Number.POSITIVE_INFINITY;
        return left - right || b.score - a.score;
      });
    } else if (filters.sort === "name") {
      ranked = ranked.sort((a, b) => a.fullName.localeCompare(b.fullName, "es") || b.score - a.score);
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
