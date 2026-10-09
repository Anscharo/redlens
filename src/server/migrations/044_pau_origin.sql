-- Where each PAU configuration change came from (src/server/pau/origin.ts), and
-- the two records origin attribution reads besides pau_events.

-- One row per (chain, tx) that holds a pau_events configuration change. kind is
-- what the chain proves: a Sky spell (directly, through the prime's StarGuard,
-- or relayed to an L2 with the bridge message id proving the link); an action
-- set relayed from Ethereum whose L1 message is not proven ("relayed", no
-- spell); an operator acting through the Configurator; a contract creation;
-- any other direct call; or nothing resolvable yet ("unknown", retried).
CREATE TABLE IF NOT EXISTS pau_tx_origin (
  chain        TEXT NOT NULL,
  tx_hash      TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('spell', 'relayed', 'operator', 'deployment', 'direct', 'unknown')),
  path         TEXT,           -- spell: direct | starguard; relayed spell: op-stack | arbitrum
  spell        TEXT,           -- the DssSpell: DSPause.exec's caller in the cast transaction
  star_spell   TEXT,
  l1_tx        TEXT,           -- the Ethereum transaction that ran the star spell or sent the relay
  tx_from      TEXT,
  tx_to        TEXT,
  relay        JSONB,          -- { executor, actionsSet, queueTx, messageId }
  evidence     TEXT NOT NULL,  -- which rule matched, in words a reader can check
  resolved_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain, tx_hash)
);
CREATE INDEX IF NOT EXISTS pau_tx_origin_spell ON pau_tx_origin (spell);

-- Every DSPause plan executed on Ethereum. DSPause.exec logs an anonymous
-- LogNote whose first indexed word is the caller, which is the spell, so this
-- is the list of every cast spell and the transaction that cast it.
CREATE TABLE IF NOT EXISTS spell_casts (
  tx_hash     TEXT PRIMARY KEY,
  spell       TEXT NOT NULL,
  block       BIGINT NOT NULL,
  block_time  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS spell_casts_spell ON spell_casts (spell);

-- How far spell_casts has been read (one row).
CREATE TABLE IF NOT EXISTS spell_cast_cursor (
  id          INT PRIMARY KEY CHECK (id = 1),
  next_block  BIGINT NOT NULL,
  checked_at  TIMESTAMPTZ NOT NULL,
  last_error  TEXT
);

-- Executive votes older than the vote record (makerdao/community), filled a few
-- files per worker tick. A row is 'verified' only when its spell is in
-- spell_casts and was cast on or after the vote's date; 'rejected' says why
-- not; 'pending' is fetched (or re-checked) on a later tick.
CREATE TABLE IF NOT EXISTS executive_archive (
  file        TEXT PRIMARY KEY,
  status      TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'rejected')),
  spell       TEXT,
  title       TEXT,
  date        TEXT,           -- YYYY-MM-DD, the vote's frontmatter date
  reason      TEXT,
  checked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS executive_archive_spell ON executive_archive (spell);
