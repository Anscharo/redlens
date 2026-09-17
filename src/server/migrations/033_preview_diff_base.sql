-- What a preview was ACTUALLY redlined against — a durable record.
--
-- Until now that lived only in the bundle's meta.json, on ephemeral disk (wiped
-- on every deploy, LRU-evicted after 20). The row kept just the declared INPUTS
-- (pr_base_repo/pr_base_ref, default_branch), which say what could have been a
-- base, not which one was picked or at what commit. Diagnosing "the preview
-- shows a completely different diff" (2026-09) had to infer the base from a
-- `ref = 'pull-N'` naming quirk because nothing recorded it.
--
--   diff_base_kind     'repo' | 'sky' | 'live-main' — the automatic pick
--                      (PreviewBases.auto). 'live-main' is the degrade.
--   diff_base          '<owner>/<repo>:<branch>@<commit>' for that pick: the
--                      merge base the added/changed list was computed from, or
--                      the served atlas commit when the pick is live-main.
--   diff_bases         the whole PreviewBases object — BOTH candidates with
--                      their merge bases + ahead/behind, the degrade reason,
--                      and the repo candidate's drift vs sky main.
--   base_atlas_commit  the atlas commit being served at build time. The 'sky'
--                      pair renders its patches against it, so it is part of
--                      what the reader saw even when diff_base is a fork point.
--   diff_added / diff_changed  size of the automatic pair's doc list — the
--                      number a report of "hundreds of docs I never touched"
--                      is about.
--
-- All NULL on rows written before this migration, and on a cold-start build
-- that could not write diff artifacts at all. Overwritten on a same-sha
-- rebuild (the row is keyed by sha); the per-build history is the
-- `[preview] <sha8>: redlined vs …` log line.
ALTER TABLE previews ADD COLUMN IF NOT EXISTS diff_base_kind TEXT;
ALTER TABLE previews ADD COLUMN IF NOT EXISTS diff_base TEXT;
ALTER TABLE previews ADD COLUMN IF NOT EXISTS diff_bases JSONB;
ALTER TABLE previews ADD COLUMN IF NOT EXISTS base_atlas_commit TEXT;
ALTER TABLE previews ADD COLUMN IF NOT EXISTS diff_added INTEGER;
ALTER TABLE previews ADD COLUMN IF NOT EXISTS diff_changed INTEGER;
