-- PAU configuration history and live state (src/server/pau/). The contract list
-- comes from the curated registry (src/data/pau-registry.json); these tables
-- hold only what the chain says about those contracts.

-- One row per admin event (role grants, rate-limit settings, pool parameters,
-- diamond integrations) on a registry contract. args is the decoded event,
-- bigints as decimal strings. Re-fetching a window is harmless: the key is the
-- log's identity on its chain.
CREATE TABLE IF NOT EXISTS pau_events (
  chain       TEXT NOT NULL,
  tx_hash     TEXT NOT NULL,
  log_index   INT NOT NULL,
  contract    TEXT NOT NULL,            -- lowercase address that emitted it
  event       TEXT NOT NULL,
  args        JSONB NOT NULL,
  block       BIGINT NOT NULL,
  block_time  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS pau_events_contract ON pau_events (chain, contract, block);

-- How far each (contract, event) has been read. One cursor per event type,
-- because explorer log APIs filter on one topic0 per request; checked_at
-- orders the rotation so every cursor is visited before any is revisited.
CREATE TABLE IF NOT EXISTS pau_cursor (
  chain       TEXT NOT NULL,
  contract    TEXT NOT NULL,
  topic0      TEXT NOT NULL,
  event       TEXT NOT NULL,
  next_block  BIGINT NOT NULL DEFAULT 0, -- first block not yet read
  checked_at  TIMESTAMPTZ,              -- NULL = never visited, sorts first
  last_error  TEXT,
  PRIMARY KEY (chain, contract, topic0)
);

-- The live snapshot of one registry deployment (deploymentId: prime:chain:kind).
CREATE TABLE IF NOT EXISTS pau_state (
  deployment  TEXT PRIMARY KEY,
  prime       UUID NOT NULL,
  chain       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('monolithic', 'diamond')),
  state       JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL
);
