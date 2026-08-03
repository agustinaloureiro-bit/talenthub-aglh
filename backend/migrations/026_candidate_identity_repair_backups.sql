CREATE TABLE IF NOT EXISTS candidate_identity_repair_backups (
  repair_id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  previous_full_name TEXT NOT NULL,
  proposed_full_name TEXT NOT NULL,
  evidence_source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  reverted_at TIMESTAMPTZ,
  PRIMARY KEY (repair_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS candidate_identity_repair_backups_candidate_idx
  ON candidate_identity_repair_backups(candidate_id, created_at DESC);
