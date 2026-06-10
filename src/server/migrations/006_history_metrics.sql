-- Per-entry metrics build-history.mjs computes but the Postgres sink dropped
-- when history moved off the static JSON files: edit-significance class
-- (lint / typo / semantic) and PR review counters. Rendered by the history
-- panel (EntryRow) and radar actor history. Existing rows are backfilled by
-- the next `pnpm build:history --full` walk.
ALTER TABLE atlas_history ADD COLUMN IF NOT EXISTS change_kind    TEXT;
ALTER TABLE atlas_history ADD COLUMN IF NOT EXISTS review_count   INT;
ALTER TABLE atlas_history ADD COLUMN IF NOT EXISTS approval_count INT;
ALTER TABLE atlas_history ADD COLUMN IF NOT EXISTS comment_count  INT;
