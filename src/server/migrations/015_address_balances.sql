-- On-chain token balances for the On-Chain Addresses report. Written by the
-- /api/balances refresh (POST) and by the atlas worker's rolling batch
-- (src/server/balances/refresh.ts), never by sync: sync's atlas_addresses
-- upsert ON CONFLICT set-list covers only its own columns, so these two survive
-- a re-sync of an unchanged address. A row that drops out of the atlas is GC'd
-- by sync (DELETE WHERE atlas_sha <> current), taking its balances with it.
--
--   balances            jsonb  — { SYMBOL: { raw, decimals } }, incl. native gas
--                                 symbol (e.g. "ETH"); raw is an integer string.
--   balances_checked_at timestamptz — per-row fetch time. MAX() across the
--                                 table is the once-per-hour ceiling on doing
--                                 any lookup at all; MIN() (the oldest reading)
--                                 is what the report shows and what gates the
--                                 full POST sweep. A row is stamped whenever a
--                                 fetcher answered for it, even with nothing to
--                                 report — see refresh.ts's progress invariant.
ALTER TABLE atlas_addresses
  ADD COLUMN IF NOT EXISTS balances            jsonb,
  ADD COLUMN IF NOT EXISTS balances_checked_at timestamptz;
