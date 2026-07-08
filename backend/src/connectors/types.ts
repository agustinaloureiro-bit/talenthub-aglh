import type {
  AgentHealth,
  AgentSearchQuery,
  AgentSyncResult,
  CandidateDocumentImport,
  CandidateImport,
  IntegrationAgent
} from "../agents/types.js";

export type ConnectorId = "aglh" | "buscojobs" | "drive" | "gmail" | "linkedin" | "yoiners" | string;

export type ConnectorConfig = Record<string, unknown>;

export type ConnectorSyncContext = {
  sourceId: ConnectorId;
  startedAt: Date;
};

export type SourceConnector = IntegrationAgent & {
  id: ConnectorId;
  sync(config: ConnectorConfig, context?: ConnectorSyncContext): Promise<AgentSyncResult>;
};

export type {
  AgentHealth,
  AgentSearchQuery,
  AgentSyncResult,
  CandidateDocumentImport,
  CandidateImport
};
