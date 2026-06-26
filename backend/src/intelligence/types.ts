export type TalentSearchFilters = {
  source?: string[];
  seniority?: string;
  activeOnly?: boolean;
};

export type InterpretedTalentQuery = {
  originalQuery: string;
  normalizedQuery: string;
  roles: string[];
  skills: string[];
  languages: string[];
  seniority?: string | null;
  industries: string[];
  mustHave: string[];
};

export type TalentCandidateResult = {
  id: string;
  fullName: string;
  currentRole?: string | null;
  city?: string | null;
  country?: string | null;
  seniority?: string | null;
  years?: number | null;
  tags: string[];
  qualityScore: number;
  score: number;
  matchReason: string;
};

export type TalentSearchResult = {
  query: InterpretedTalentQuery;
  data: TalentCandidateResult[];
  explanation: string;
  mode: "intelligence_fallback" | "semantic";
};