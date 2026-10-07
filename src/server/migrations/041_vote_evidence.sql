-- Stale Dates vote evidence as the atlas worker refines it
-- (src/server/sync-vote-evidence.ts): the final verdict per claim, served by
-- GET /api/vote-evidence. One row, replaced on every run.
CREATE TABLE IF NOT EXISTS vote_evidence (
  id INT PRIMARY KEY CHECK (id = 1),
  atlas_sha TEXT,
  claims JSONB NOT NULL,
  -- false while some claim still waits for the decision model (capped or failed);
  -- the next worker cycle runs again instead of waiting out the refresh interval.
  complete BOOLEAN NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL
);

-- Each decision-model answer and atlas-history lookup, keyed by a hash of the
-- exact request, so a claim costs one call until its sentence, its document or
-- its vote changes.
CREATE TABLE IF NOT EXISTS vote_evidence_cache (
  key TEXT PRIMARY KEY,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
