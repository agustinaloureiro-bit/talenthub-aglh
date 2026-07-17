export type CandidateDocumentImport = {
  type: string;
  fileName: string;
  fileUrl?: string | null;
  rawText?: string | null;
  mimeType?: string | null;
  fileDataBase64?: string | null;
  sizeBytes?: number | null;
  fileHash?: string | null;
  sourceId?: string | null;
  sourcePath?: string | null;
  isPrimaryCv?: boolean;
};

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
  languages?: Array<{ lang: string; level?: string | null; evidence?: string }>;
  summary?: string | null;
  qualityScore: number;
  sourceId?: string | null;
  sourceUrl?: string | null;
  documents?: CandidateDocumentImport[];
  raw: Record<string, unknown>;
};

export type AgentHealth = {
  ok: boolean;
  status: "connected" | "warning" | "error" | "not_configured";
  message: string;
};

export type AgentSearchQuery = {
  text: string;
  roles?: string[];
  skills?: string[];
  languages?: string[];
  seniority?: string | null;
  limit?: number;
};

export type AgentSyncResult = {
  rows: CandidateImport[];
  message: string;
  configUpdate?: Record<string, unknown>;
};

export type IntegrationAgent = {
  id: string;
  name: string;
  healthCheck?(config: Record<string, unknown>): Promise<AgentHealth>;
  sync(config: Record<string, unknown>): Promise<AgentSyncResult>;
  search?(query: AgentSearchQuery, config: Record<string, unknown>): Promise<CandidateImport[]>;
  getCandidate?(id: string, config: Record<string, unknown>): Promise<CandidateImport | null>;
  downloadCV?(id: string, config: Record<string, unknown>): Promise<CandidateDocumentImport | null>;
};
