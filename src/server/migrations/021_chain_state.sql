-- The on-chain contract-state snapshot: every no-arg view function on every
-- chainlog contract, read in one multicall batch (scripts/required/fetch-chain-state.mjs).
--
-- This used to be a COMMITTED artifact (public/chain-state.json) refreshed by a
-- weekly GitHub workflow that opened a PR. It now lives here: the Railway atlas
-- worker fetches it on a time gate (CHAINSTATE_REFRESH_SECONDS, default daily)
-- and the frontend reads it back through /api/chain-state. The row is the whole
-- snapshot, stored exactly as the fetcher emits it — no per-address explosion:
--   { block: "25741379", values: { "0x…": { "wards": "1", … } } }
-- sync.ts joins it onto atlas_addresses.chain_state (see doc-rows.ts) the same
-- way it did when the JSON file was the input.
--
-- Single row, id pinned to 1 — same shape as sync_state (001_init_atlas.sql):
-- there is exactly one current snapshot, and a CHECK keeps a second one from
-- ever appearing. Refreshing is an upsert; history is not kept (a snapshot is a
-- point-in-time read of state that is itself queryable on-chain).
--
-- NOTE: "values" is a RESERVED word in Postgres — every reference to the column
-- must be double-quoted (see chain-state.ts). The column is named for the JSON
-- key it carries so the stored row and the served payload read identically.
--
--   block      text        — decimal block number, as a string (bigint > JSON safe int)
--   "values"   jsonb       — { [addressLower]: { [fnName]: value | null } }
--   fetched_at timestamptz — when the multicall ran; THE cadence gate reads this
CREATE TABLE IF NOT EXISTS chain_state (
  id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  block      TEXT,
  "values"   JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ
);
