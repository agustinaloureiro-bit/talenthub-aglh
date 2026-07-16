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
  email?: string[];
  phone?: string[];
  summary?: string | null;
  qualityScore: number;
  sourceCount?: number;
  documentCount?: number;
  primaryDocumentName?: string | null;
  documentSnippet?: string | null;
  score: number;
  matchReason: string;
};

export type TalentSearchResult = {
  query: InterpretedTalentQuery;
  data: TalentCandidateResult[];
  explanation: string;
  mode: "intelligence_fallback" | "semantic";
};
