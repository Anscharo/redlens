# Markdown-era lineage: splits, merges, reintroductions, swap verification

**Status: planned** (2026-07-03). Port of the HTML-era reconstruction techniques to the
modern (post-#117) git-based history — the parts that still matter when UUIDs exist.

## Why

UUIDs solve *continuity* identity: a doc that keeps its UUID threads itself, so the whole
HTML-era matching stack (matcher tiers, positional signals, claim elimination, survivor
exclusion) is obsolete in the md era. But UUIDs solve **nothing at births and deaths**:

- A doc **split** into new docs ships as bare `added` events (new UUIDs) + a `removed`/shrunk
  `modified` on the source. No `extracted_from`. The renumbering (PR #235) and atomization
  (PR #236) commits are exactly this shape, at bulk scale.
- A **merge** ships as a silent `removed` + an unrelated grown `modified`. No `merged_into`.
- A doc **deleted and later recreated** — same UUID after a gap, or same content under a
  fresh UUID — ships as an unrelated birth. No reintroduction link (the md-era analogue of
  the committed `history-reintroductions.json` ledger).
- A **UUID swap** (content migrating between two UUIDs in one commit — the PR #108 preview
  detector's subject) records as two fabricated "rewrites" in both docs' histories.

The 2026-07-03 HTML-era audit showed how much lineage hides in births/deaths (84 orphaned
lineages recovered, 50 cross-agent fabrications fixed). The md era accumulates the same
debt silently with every restructure commit.

## What already exists (verified against current code)

| Piece | Where | State |
| --- | --- | --- |
| Snapshot diff `added/modified/removed/moved` per commit | `scripts/required/build-history.mjs` (`diffSnapshots`, ~L294) | no content matching between added and removed sets — bullets matching is PR-annotation only |
| DB columns `seam`, `extracted_from`, `merged_into`, `move_kind` | `src/server/history-db.ts` (`ROW_KEYS`, `eventToRow`), migrations `009_html_era.sql` / `010_history_method.sql` | exist; **md-era rows write NULLs** — `eventToRow` already maps `extractedFrom`/`mergedInto` if the event object carries them |
| Split/merge detector (ordered containment, size-mult ≥1.3, uniqueness guard, different-title gate) | `scripts/htmlhist/history-lineage.mjs` (`detectLineage`) + `scripts/htmlhist/ordered-containment.mjs` (`findContainer`) | pure modules over generic node lists — direct reuse; build-history already materializes `prevSnapshot`/`snapshot` per commit |
| Swap detector | `src/server/preview/identity.ts` lineage (`detectIdentitySwaps` idiom) + `scripts/htmlhist/verify-thread-swaps.mjs` | exists for previews / HTML chains; not run over md history |
| FE badges (seam, ai/human method) | `src/components/history/EntryRow.tsx` | **gated on `entry.era === "html"`** — must be loosened for md-era seams |
| Incremental walk + backfill idiom | `build-history.mjs` cursor via `MAX(commit_seq)`; `--full` re-walk (see the migration-006 backfill note in CLAUDE.md) | reuse as-is |

## Constraints

- `build:history` runs in **production** (atlas worker, every cycle). Everything added must be
  **deterministic** (containment/hash matching only — no LLM on this path, no timestamps,
  no randomness) and cheap under the incremental walk (only new commits pay).
- LLM-assisted steps, if any, stay **offline** (measurement/review scripts writing to
  `.cache/`), mirroring the htmlhist audit discipline.
- Two-signal discipline for anything that *creates* lineage links: containment alone locks
  only with the structural guards (size-mult, uniqueness, same-commit); anything weaker is
  report-only until reviewed.
- Doc identity by UUID only; the structural-suffix exception aside, no doc_no keys anywhere.

## Phases (measurement first, per house rule)

### Phase 0 — measure (offline, no pipeline changes)

`scripts/aux/measure-md-lineage.mjs` (or `scripts/htmlhist/`-adjacent naming TBD — it is
md-era tooling, so probably a new `scripts/aux/` script): walk the md-era commits exactly
like build-history does, and report to `.cache/md-lineage-report.{json,md}`:

1. **Split candidates**: per commit, for each `added` UUID, `findContainer` over that
   commit's `removed` + shrunk `modified` docs. Count, sample, per-commit clustering
   (expectation: #235/#236 dominate).
2. **Merge candidates**: inverse probe for each `removed`.
3. **Same-UUID reintroductions**: per-UUID event streams with `removed → (gap) → added`.
   Pure stream scan, no matching. Count + gap distribution.
4. **New-UUID rebirths**: content-hash index of dead docs (normalized), match later births
   exact-hash first, containment second. Count by match tier.
5. **Swap suspects**: consecutive same-UUID versions with `sameDocScore ≤ 0.2` + a
   relocation target elsewhere in the same commit (the `verify-thread-swaps` recipe).

Output gates everything below. **No counts → stop.** Expected effort: one session; the
detectors are imports, the walk is a copy of build-history's loop minus the sinks.

### Phase 1 — same-UUID reintroduction tagging (cheapest, purely mechanical)

When a UUID's stream shows `removed` at commit *i* and `added` at commit *j > i*, tag the
re-add event `seam: "reintroduced"` (+ optionally `gapCommits: j−i`). No matching, no
thresholds, no judgment — deterministic from the stream alone.

- Full-walk case: trivial (streams are in memory).
- Incremental case: the walk doesn't know prior history. DB sink: one query per `added`
  UUID in the batch — "does this UUID have rows, and is its latest row `removed`?"
  (`--out-json` sink: read the existing per-uuid file — the append path already does).
- FE: loosen the `era === "html"` gate in `EntryRow` to show the seam badge for md rows;
  add a "reappeared after N commits" tooltip.
- Backfill: `pnpm build:history --full` once, same as migration 006.

### Phase 2 — split/merge lineage at births/deaths (`extracted_from` / `merged_into`)

Wire `detectLineage`-style probing into the md-era event build:

- For each `added` UUID in a commit: probe that commit's `removed` ∪ shrunk-`modified`
  docs with `findContainer` (ordered containment ≥0.9, size-mult ≥1.3, unique container,
  keep the different-title gate initially — Phase 0 decides whether to relax it).
  On a hit: set `extractedFrom: <source uuid>` on the `added` event.
- For each `removed`: probe grown docs → `mergedInto`.
- `eventToRow` already forwards both fields; no migration needed. Rows backfill via `--full`.
- Determinism: containment is pure; guard order fixed; ties → no link (uniqueness guard).
- Cost bound: probing is O(births × candidates) per commit but candidates are same-commit
  deaths/shrinks only — tiny outside restructure commits. Add a per-commit cap + `[drift]`-style
  warning log if a commit exceeds it rather than silently scanning forever.
- FE: `EntryRow`/`NodeHistory` render "extracted from <doc>" / "merged into <doc>" links
  (same treatment the html-era docMeta gets today).

### Phase 3 — new-UUID rebirth linking (md reintroductions proper)

The analogue of the Keel ledger, but deterministic where possible:

- **Tier A (auto)**: exact normalized-content hash match between a dead doc and a later
  birth → `seam: "reintroduced"` + backlink (`reintroducedFrom: { uuid, removedAt }`).
  Exact hash + uniqueness (one dead doc, one birth) = two signals; lock.
- **Tier B (report-only)**: containment / high-similarity matches, or multi-candidate
  hashes → `.cache` report for review, promoted by hand into a committed ledger file
  (`public/history-md-reintroductions.json`, mirroring the html one) that build-history
  reads. Never auto-applied — same posture as the html ledger.
- Window: bound the lookback (e.g. 26 weekly commits) so the dead-doc index stays small;
  Phase 0's gap distribution sets the number.

### Phase 4 — swap verification (report-only, guard not pipeline)

Port `verify-thread-swaps.mjs` to md streams: flag same-UUID content cliffs with a
relocation target in the same commit. Output to `.cache/md-swap-report.json`. If Phase 0
finds real swaps, decide then whether the history should *annotate* them (an
`identity-swap` seam on both events) or whether they warrant an upstream atlas fix —
swaps are editorial errors, and PR #108's ⚠ warning already covers previews going forward.

## Explicitly not ported

- Matcher/positional/claim-elimination/survivor-exclusion — occurrence ambiguity does not
  exist under UUIDs.
- The audit-every-decision LLM pass — identity is deterministic here. If Tier-B rebirth
  links accumulate, a one-shot audit of *those* follows the same classifier discipline
  (occ-equivalence has no md analogue; the buckets shrink to content/section checks).
- Cross-agent guard — `check-cross-agent.mjs` is seed-specific. Its md descendant, if ever
  needed, is "extraction source and new doc share an ancestor scope" as a report-only
  sanity column in Phase 0/2 output.

## Rollout / touchpoints

| Change | Files | Risk |
| --- | --- | --- |
| Phase 0 script | new `scripts/aux/measure-md-lineage.mjs` | none (offline, `.cache/` only) |
| Phase 1 tagging | `build-history.mjs` (+1 DB probe per added-uuid batch), `EntryRow.tsx` gate | low; deterministic; backfill via `--full` |
| Phase 2 lineage | `build-history.mjs` event build; reuse `history-lineage.mjs` / `ordered-containment.mjs` (move to `scripts/lib/` if htmlhist coupling bothers) | medium: production path — cap + log, snapshot tests unaffected (history isn't on `pnpm build`) |
| Phase 3A auto + 3B ledger | `build-history.mjs`, new committed ledger file, offline report script | low/medium |
| Phase 4 report | new offline script | none |

Each phase lands separately, stats-before-UI: Phase 0's report is reviewed before any
pipeline edit, and every FE-visible change (badges, links) comes after its data is already
verified in the DB.

## Open questions

1. Does the different-title gate in `detectLineage` fit the md era? Atomization created
   many same-title children — Phase 0 should measure both gated and ungated precision.
2. `moved` + heavy-`modified` interplay: build-history reclassifies some added→moved
   (L489); lineage probing must run on the *pre*-reclassification added set or it misses
   relocated splits. Verify during Phase 2.
3. Where do html-era and md-era reintroduction ledgers converge? Two files mirroring each
   other is fine short-term; a unified `history-reintroductions.json` with an `era` field
   is cleaner if the FE grows a shared "revived" treatment.
4. Should Phase 2 links be exposed to the MCP server (graph edges) too? `graph.json` is
   the MCP-side artifact; lineage edges there would make `atlas_history`-style queries
   answerable by the worker. Defer until the reader FE proves the data.
