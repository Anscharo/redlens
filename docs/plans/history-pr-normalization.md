# Atlas History PR Metadata Normalization

**Status:** Phase 1 landed; Phase 2 deferred until production verification.

## Context

`atlas_history` is event-grained: one row per document, commit, and change type. PR header/review metadata is PR-grained, so Phase 1 introduced `atlas_prs` and dual-read fallback while leaving the legacy columns in place.

Per-event fields stay on `atlas_history`. In particular, `summary` and `description` are matched to individual changed Atlas nodes from PR body bullets and must not be normalized into `atlas_prs`.

## Phase 1 - already implemented

- Added `atlas_prs`.
- Backfilled it from existing `atlas_history` rows.
- Added `atlas_pr_metadata_conflicts` to audit conflicting legacy PR metadata.
- Dual-writes PR metadata from the history DB sink.
- Dual-reads with legacy-first fallback:
  - `COALESCE(h.pr_title, p.title)`
  - `COALESCE(h.pr_url, p.url)`
  - `COALESCE(h.pr_author, p.author)`
  - same pattern for review/comment counters.
- Kept all legacy `atlas_history` PR columns for rollback safety.

## Phase 2 - contract cleanup plan

Do not start this phase until Phase 1 has deployed and the verification gates below pass.

### Verification gates

1. `atlas_pr_metadata_conflicts` returns zero rows, or every conflict is understood and resolved.
2. Every non-null `atlas_history.pr_number` has a matching `atlas_prs.pr_number`.
3. History API output is unchanged from Phase 1 dual-read output, except that previously missing PR fields may be filled from `atlas_prs`.
4. Chat/MCP history tools return the same PR fields through the join path.
5. A full `pnpm build:history --full` run can repopulate/update `atlas_prs` without losing metadata.

Suggested audit queries:

```sql
SELECT * FROM atlas_pr_metadata_conflicts;

SELECT h.pr_number, COUNT(*) AS history_rows
FROM atlas_history h
LEFT JOIN atlas_prs p ON p.pr_number = h.pr_number
WHERE h.pr_number IS NOT NULL AND p.pr_number IS NULL
GROUP BY h.pr_number
ORDER BY h.pr_number;
```

### Cleanup steps

1. Update readers to select PR metadata directly from `atlas_prs` after the join, not through legacy fallback.
2. Update `HistoryInsert`, `HISTORY_COLS`, and `upsertHistory` so `atlas_history` no longer writes PR header/review columns.
3. Keep `pr_number` on `atlas_history` as the join key.
4. Add a destructive migration that drops only duplicated PR-grained columns:
   - `pr_title`
   - `pr_url`
   - `pr_author`
   - `review_count`
   - `approval_count`
   - `comment_count`
5. Keep event-grained fields on `atlas_history`:
   - `summary`
   - `description`
   - `change_kind`
   - `diff`
   - movement, era, method, and source fields.
6. Update tests to assert PR data comes from `atlas_prs`.
7. Remove the legacy fallback comments once the contract migration is complete.

### Rollback rule

If any verification gate fails, do not drop columns. Leave Phase 1 in place, fix the data or dual-write path, and re-run the audits.
