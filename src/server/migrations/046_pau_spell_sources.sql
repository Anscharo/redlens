-- The naming material of every spell behind a stored PAU change
-- (src/server/pau/spell-sources.ts): the LIMIT_* names, address constants and
-- bytes32 constants of its verified source, which the rate-limit key namer adds
-- to its candidates. The worker's container starts without the explorer cache
-- it fetched last run, so the material is kept here, one row per spell.
CREATE TABLE IF NOT EXISTS pau_spell_sources (
  chain          TEXT NOT NULL,
  address        TEXT NOT NULL,
  contract_name  TEXT NOT NULL,   -- '' when no explorer has the source verified; retried later
  material       JSONB NOT NULL,  -- { names, addresses, words, spells }, each a sorted array of strings
  fetched_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain, address)
);
