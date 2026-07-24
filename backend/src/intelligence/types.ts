export type TalentSearchFilters = {
  source?: string[];
  seniority?: string;
  location?: string;
  contact?: "email" | "phone" | "both";
  minScore?: number;
  activeOnly?: boolean;
  recency?: "7d" | "30d" | "90d" | "365d";
  sort?: "relevance" | "recent";
};

export type InterpretedTalentQuery = {
  originalQuery: string;
  normalizedQuery: string;
  roles: string[];
  skills: string[];
  languages: string[];
  seniority?: string | null;
  industries: string[];
  locations: string[];
  keywords: string[];
  locationGroups: string[][];
  locationStrict: boolean;
  profileLevel?: "basic" | null;
  ignoredCriteria: string[];
  mustHave: string[];
  requiredGroups: string[][];
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
  primaryDocumentId?: string | null;
  primaryDocumentMimeType?: string | null;
  primaryDocumentSourceType?: string | null;
  documentSnippet?: string | null;
  latestSourceAt?: string | null;
  matchDistanceKm?: number | null;
  score: number;
  matchReason: string;
};

export type TalentSearchResult = {
  query: InterpretedTalentQuery;
  data: TalentCandidateResult[];
  explanation: string;
  mode: "intelligence_fallback" | "semantic";
};
