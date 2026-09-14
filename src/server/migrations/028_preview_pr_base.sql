-- PR-base redlining: a PR preview compares against its OWN declared base
-- branch, never canonical next-gen-atlas main (docs/plans — see resolve.ts's
-- prBase / PreviewMeta.prBase). Two additive columns persist that base so a
-- pinned-sha rebuild (resolveId's "sha" branch in handler.ts) keeps PR-base
-- treatment without re-asking GitHub:
--
--   previews.pr_base_repo — owner/name of the repo the PR's base branch lives
--     in (usually the canonical repo, or the PR's own repo for a fork PR).
--   previews.pr_base_ref  — the base branch name (e.g. "main", "develop").
--
--   previews.default_branch — the head repo's default branch (fork BRANCH
--     previews only): the `repo` diff-base candidate of a fork branch, which a
--     rebuild would otherwise lose (the switch would silently vanish).
--
-- No pr_base_sha column: the tip is re-resolved on rebuild (base drift is the
-- point of tracking it — a stale pinned sha would defeat that). All columns
-- default NULL so every existing branch/canonical-branch preview is unaffected.
ALTER TABLE previews ADD COLUMN IF NOT EXISTS pr_base_repo TEXT;
ALTER TABLE previews ADD COLUMN IF NOT EXISTS pr_base_ref TEXT;
ALTER TABLE previews ADD COLUMN IF NOT EXISTS default_branch TEXT;
