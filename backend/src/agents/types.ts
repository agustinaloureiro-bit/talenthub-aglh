export type CandidateImport = {
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string[];
  phone: string[];
  city?: string | null;
  country?: string | null;
  linkedinUrl?: string | null;
  currentRole?: string | null;
  seniority?: string | null;
  years?: number | null;
  tags: string[];
  summary?: string | null;
  qualityScore: number;
  sourceId?: string | null;
  sourceUrl?: string | null;
  raw: Record<string, unknown>;
};

export type AgentSyncResult = {
  rows: CandidateImport[];
  message: string;
};

export type IntegrationAgent = {
  id: string;
  name: string;
  sync(config: Record<string, unknown>): Promise<AgentSyncResult>;
};
