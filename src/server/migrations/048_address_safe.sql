-- A Safe's live signing setup, { threshold, owners: [address, …] }, read by
-- the same refresh paths that write balances (015) through getThreshold() and
-- getOwners() (src/server/balances/safe-reads.ts). NULL = not a Safe, or not
-- read yet. Sync's atlas_addresses upsert does not list it, so it survives a
-- re-sync of an unchanged address like balances and has_code do.
ALTER TABLE atlas_addresses
  ADD COLUMN IF NOT EXISTS safe jsonb;
