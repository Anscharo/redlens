-- An svm deployment (the Solana ALM program) is stored in pau_state like the
-- EVM generations.
ALTER TABLE pau_state DROP CONSTRAINT IF EXISTS pau_state_kind_check;
ALTER TABLE pau_state ADD CONSTRAINT pau_state_kind_check CHECK (kind IN ('monolithic', 'diamond', 'svm'));

-- How far an svm program's configuration events have been read from HyperSync
-- (src/server/pau/svm-sync.ts). One row per program: one query reads every
-- event the program emits. The window read is [start_time, reached_at]; the
-- snapshot reads a history as complete only when it reaches the head, holds no
-- error and starts far enough back (svm-history.ts).
CREATE TABLE IF NOT EXISTS pau_svm_cursor (
  chain        TEXT NOT NULL,
  program      TEXT NOT NULL,             -- base58 program id
  controllers  TEXT NOT NULL,             -- sorted registry controllers stored, comma-separated; a change restarts at start_slot
  start_slot   BIGINT NOT NULL,           -- the first slot HyperSync held when the cursor was made
  start_time   TIMESTAMPTZ NOT NULL,      -- the time of the first block at or after start_slot
  next_slot    BIGINT NOT NULL,           -- first slot not yet read
  reached_at   TIMESTAMPTZ,               -- when a pass last read through to the head; NULL until one has
  checked_at   TIMESTAMPTZ,
  last_error   TEXT,
  PRIMARY KEY (chain, program)
);
