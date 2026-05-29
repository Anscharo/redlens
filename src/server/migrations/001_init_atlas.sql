-- Atlas schema. Content + FTS + graph live in memory; Postgres holds only what
-- benefits from SQL: vectors (pgvector), addresses, history, slim doc metadata.
-- No chat tables this phase (auth + chatbot out of scope).

CREATE EXTENSION IF NOT EXISTS vector;

-- Structural metadata only — no content, no tsv. content_hash = sha256(title + content)
-- (see embed-text.ts); excludes doc_no/parent/depth so a pure renumber doesn't
-- churn embeddings.
CREATE TABLE IF NOT EXISTS atlas_doc_meta (
  id            UUID PRIMARY KEY,
  doc_no        TEXT NOT NULL,
  title         TEXT NOT NULL,
  type          TEXT NOT NULL,
  depth         INT  NOT NULL,
  ord           INT  NOT NULL DEFAULT 0,   -- sibling order within parent (docs.json .order; not always derivable from doc_no, e.g. NR-X)
  parent_id     UUID,
  content_hash  TEXT NOT NULL,
  atlas_sha     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS atlas_doc_meta_type   ON atlas_doc_meta(type);
CREATE INDEX IF NOT EXISTS atlas_doc_meta_parent ON atlas_doc_meta(parent_id);

CREATE TABLE IF NOT EXISTS atlas_doc_embeddings (
  doc_id        UUID PRIMARY KEY REFERENCES atlas_doc_meta(id) ON DELETE CASCADE,
  embedding     vector(1024) NOT NULL,
  content_hash  TEXT NOT NULL,
  atlas_sha     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS atlas_emb_hnsw ON atlas_doc_embeddings
  USING hnsw (embedding vector_cosine_ops);

-- Composite PK: same EVM address can appear on multiple chains.
CREATE TABLE IF NOT EXISTS atlas_addresses (
  address         TEXT NOT NULL,
  chain           TEXT NOT NULL,
  label           TEXT,
  chainlog_id     TEXT,
  etherscan_name  TEXT,
  is_contract     BOOLEAN DEFAULT false,
  is_proxy        BOOLEAN DEFAULT false,
  implementation  TEXT,
  roles           JSONB,
  aliases         JSONB,
  expected_tokens JSONB,
  chain_state     JSONB,   -- multicall snapshot; snapshot block is chain_state->>'block' (no separate column)
  entity_id       UUID,
  content_hash    TEXT NOT NULL,
  atlas_sha       TEXT NOT NULL,
  PRIMARY KEY (address, chain)   -- same EVM address can appear on multiple chains
);

CREATE INDEX IF NOT EXISTS atlas_addresses_entity ON atlas_addresses(entity_id);
CREATE INDEX IF NOT EXISTS atlas_addresses_chain  ON atlas_addresses(chain);

-- Append-only change record at commit granularity (built from public/history/*.json).
-- A doc can have multiple change types in one commit, so change_type is in the PK.
-- change_type vocabulary is mapped from node_history: modified→content,
-- moved→structural, added/removed unchanged. commit_seq is the topological git-log
-- position (merge order ≠ commit-timestamp order).
CREATE TABLE IF NOT EXISTS atlas_history (
  doc_id        UUID NOT NULL,
  commit_sha    TEXT NOT NULL,
  committed_at  TIMESTAMPTZ,
  commit_seq    INT,
  pr_number     INT,
  pr_title      TEXT,
  pr_url        TEXT,
  pr_author     TEXT,
  summary       TEXT,
  description   TEXT,
  moved_from    TEXT,
  moved_to      TEXT,
  change_type   TEXT NOT NULL,
  content_hash  TEXT,
  PRIMARY KEY (doc_id, commit_sha, change_type)
);

CREATE INDEX IF NOT EXISTS atlas_history_time   ON atlas_history(committed_at);
CREATE INDEX IF NOT EXISTS atlas_history_change ON atlas_history(change_type);
CREATE INDEX IF NOT EXISTS atlas_history_seq    ON atlas_history(commit_seq);

-- Single-row pointer to "what's loaded".
CREATE TABLE IF NOT EXISTS sync_state (
  id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  atlas_sha  TEXT NOT NULL,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Thin operational ledger: one row per sync that changed data.
CREATE TABLE IF NOT EXISTS sync_log (
  id          BIGSERIAL PRIMARY KEY,
  atlas_sha   TEXT NOT NULL,
  prev_sha    TEXT,
  inserted    INT  NOT NULL,
  updated     INT  NOT NULL,
  deleted     INT  NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_log_atlas_sha ON sync_log(atlas_sha);
