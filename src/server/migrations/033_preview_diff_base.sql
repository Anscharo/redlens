-- What a preview was ACTUALLY redlined against — a durable record.
--
-- Until now that lived only in the bundle's meta.json, on ephemeral disk (wiped
-- on every deploy, LRU-evicted after 20). The row kept just the declared INPUTS
-- (pr_base_repo/pr_base_ref, default_branch), which say what could have been a
-- base, not which one was picked or at what commit. Diagnosing "the preview
-- shows a completely different diff" (2026-09) had to infer the base from a
-- `ref = 'pull-N'` naming quirk because nothing recorded it.
--
-- The record answers two questions separately (see diff-base-record.ts):
--
--   diff_base_type     WHICH BRANCH is the base:
--                        'pr-base'       the PR's own declared base branch,
--                                        including nga main itself
--                        'fork-default'  the repo's default branch (a branch
--                                        preview, or a PR whose base could not
--                                        be read and the default stands in)
--                        'nga-main'      sky-ecosystem/next-gen-atlas:main
--   diff_base_lca      is the doc list computed against a LAST COMMON ANCESTOR?
--                        true   yes — diff_base names that ancestor commit
--                        false  no — compared against LIVE nga main as served
--                               at build time, so upstream's drift shows up
--                               too. NOT "a search ran and failed": a private
--                               preview of its own default branch has no base
--                               branch by design. diff_bases->>'reason' says
--                               which; `WHERE NOT diff_base_lca` lists them.
--   diff_base          '<owner>/<repo>:<branch>@<commit>' — the ancestor commit,
--                      or the served atlas commit when diff_base_lca is false.
--   diff_bases         jsonb { reason?, candidates: { <type>: { repo, ref,
--                      mergeBase, aheadBy, behindBy, drift? } } } — EVERY
--                      candidate that resolved, not just the pick.
--   base_atlas_commit  the atlas commit being served at build time. An
--                      'nga-main' pick renders its patches against it, so it is
--                      part of what the reader saw even when diff_base is an LCA.
--   diff_added / diff_changed  size of the pick's doc list — the number a
--                      report of "hundreds of docs I never touched" is about.
--
-- All NULL on rows written before this migration, and on a cold-start build
-- that could not write diff artifacts at all. A ready bundle only touches
-- last_access, so those rows stay NULL until something re-records them.
-- The web boot runs diff-base-backfill.ts once: it recomputes the same
-- record a same-sha rebuild would write. Overwritten again on a later
-- rebuild (the row is keyed by sha); the per-build history is the
-- `[preview] <sha8>: redlined vs …` log line.
ALTER TABLE previews ADD COLUMN IF NOT EXISTS diff_base_type TEXT;
ALTER TABLE previews ADD COLUMN IF NOT EXISTS diff_base_lca BOOLEAN;
ALTER TABLE previews ADD COLUMN IF NOT EXISTS diff_base TEXT;
ALTER TABLE previews ADD COLUMN IF NOT EXISTS diff_bases JSONB;
ALTER TABLE previews ADD COLUMN IF NOT EXISTS base_atlas_commit TEXT;
ALTER TABLE previews ADD COLUMN IF NOT EXISTS diff_added INTEGER;
ALTER TABLE previews ADD COLUMN IF NOT EXISTS diff_changed INTEGER;
