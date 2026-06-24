# Live-history slot-reuse cross-reference (backport from previews)

Status: PLANNED (not started). Decided 2026-06-12 — backport the preview feature's
slot-reuse annotation to the live atlas history.

## Context

Preview diffs flag "Added\*" docs that take over an existing doc number
(`diff.json` `reusedSlot`): the new doc's history entry names the old occupant
and where it moved, and the disclaimer explains why a "new" doc shows a diff.
Live history has only half of this story:

- **Has**: `moved` events — `diffSnapshots` in `build-history.mjs` emits one
  whenever a uuid's path changes (independent of `modified`, so pure
  renumberings are visible). Stored as `change_type = 'structural'` with
  `moved_from` / `moved_to`.
- **Missing**: the NEW occupant's `added` event says nothing about the doc
  number being a reused slot. A reader looking at the new doc sees "added" with
  no hint that the number previously meant something else — exactly the
  confusion the preview disclaimer fixed.

## Detection (build-history.mjs, `diffSnapshots`)

Snapshots already carry `doc_no` per node. Per commit:

1. Build `prevByDocNo: doc_no → id` from the `prev` snapshot (one pass).
2. For each `added` doc: if `prevByDocNo.get(node.doc_no)` exists and is a
   **different** uuid → slot reuse. Attach to the added event:
   `slot: { prevId, prevTitle, movedTo? }` — `movedTo` from the old occupant's
   entry in this commit's `moved` list (absent = the occupant was removed in
   the same commit).
3. Symmetric side (optional, matches preview's "both sides tell the story"):
   attach `takenBy: { id, title }` to the old occupant's `moved`/`removed`
   event. Cheap once step 2's pairing exists.

Edge cases:
- Same uuid re-occupying its own doc_no → not slot reuse (the `!== id` guard,
  same as preview's `occupant !== id`).
- The PR #117 md-migration retag (`added` → `moved`) runs AFTER detection, or
  skip detection on that commit — every doc is "added" there and doc_nos are
  meaningless to cross-reference.
- The PR #236 atomization commit is path-only (`moved` storm, no adds) — no
  interaction.

## Storage (one migration)

> NOTE (2026-06-24): migration slot 008 is now taken (`008_preview_trust.sql`).
> Use **`009_history_slot.sql`**. See `docs/plans/html-era-history.md` §8 — that
> plan folds this one in (shared content-pairing helper, one EntryRow UI pass).

`migrations/009_history_slot.sql`:

```sql
ALTER TABLE atlas_history ADD COLUMN IF NOT EXISTS slot JSONB;
ALTER TABLE atlas_history ADD COLUMN IF NOT EXISTS taken_by JSONB;
```

JSONB (not flat columns) because the payload is a small struct rendered as one
sentence; no queries filter on its parts. Wiring is nearly free:
`HISTORY_COLS` drives both the INSERT column list and the upsert `SET_CLAUSE`
in `history-db.ts`, so adding `"slot", "taken_by"` there + two fields on
`HistoryEvent`/`HistoryInsert` + two lines in `eventToRow` completes the write
path. Cast like `diff`: `$N::jsonb` (raw value, never pre-stringified).

## Read path + UI

- `src/server/history.ts`: include `slot` / `taken_by` in the SELECT + response.
- `src/lib/history.ts`: `slot?: { prevId, prevTitle, movedTo? }`,
  `takenBy?: { id, title }` on `HistoryEntry`.
- `src/components/history/EntryRow.tsx`: on an `added` entry with `slot`,
  asterisk the label and reuse the preview disclaimer copy: *"This doc is new
  but takes over an existing doc number — previously "{prevTitle}", which
  {moved to X in this commit | was removed in this commit}."* On a `moved`
  entry with `takenBy`, one line: *"its old number was taken over by
  "{title}"."* Link both via uuid (`onNavigate`), never doc_no.

## Backfill

`build-history` is incremental (cursor = `MAX(commit_seq)`), so new fields
only populate for future commits by default. One-time
`pnpm build:history --full` re-walks everything; `ON CONFLICT … DO UPDATE`
(SET_CLAUSE includes the new cols automatically) fills `slot`/`taken_by` on
existing rows. Idempotent, minutes, no downtime — run once on the worker after
deploy.

## Verification

- Unit: `diffSnapshots` slot pairing (added-at-reused-slot, occupant moved vs
  removed, same-uuid non-case, md-migration skip).
- Known real case from the StarGuard fork analysis: new docs inserted at
  `…1.1.3` slots pushed "Genesis Account" docs to `…1.1.4` — once that PR (or
  any renumbering PR) merges, the live history must show the same
  cross-references the preview showed.
- `--out-json` canary path gets the fields for free (same event objects).

## Effort

~half a day. Files: `scripts/required/build-history.mjs`,
`src/server/history-db.ts`, `src/server/migrations/008_history_slot.sql`,
`src/server/history.ts`, `src/lib/history.ts`,
`src/components/history/EntryRow.tsx`, tests next to each.
