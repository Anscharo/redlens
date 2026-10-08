-- How far each registry contract on a chain read over JSON-RPC (the chain
-- registry's logsRpcs) has been crawled (src/server/pau/rpc-sync.ts). One row per
-- contract, because one eth_getLogs request reads every event of every contract
-- at the same position. pau_cursor still holds the per-event rows that
-- historyComplete reads; the crawl writes them when it reaches the head.
CREATE TABLE IF NOT EXISTS pau_rpc_cursor (
  chain         TEXT NOT NULL,
  contract      TEXT NOT NULL,
  topics        TEXT NOT NULL,            -- sorted topic0s read, comma-separated; a change restarts the crawl
  deploy_block  BIGINT,                   -- NULL = not found yet
  next_block    BIGINT NOT NULL DEFAULT 0, -- first block not yet read
  checked_at    TIMESTAMPTZ,
  last_error    TEXT,
  PRIMARY KEY (chain, contract)
);
