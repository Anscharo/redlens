# Atlas freshness resilience

Tracks the failure-mode hardening of the gitless runtime — the seam between the
**worker** (writes Postgres) and the **in-process updater** (reads Postgres,
republishes artifacts, hot-swaps the live in-memory index).

The invariant the updater must maintain:

> live in-memory sha === `sync_state.atlas_sha` === latest fully-synced sha,
> ∧ applied schema ≥ the schema this image's code requires,
> ∧ the worker has synced within the staleness window.

`/api/freshness` evaluates exactly this and is the alerting surface.

## Done (branch `history-refactor-gitless`, PR #70)

Commits `87036002` (boot migrations + endpoints) and the updater-hardening
follow-up:

- **Race-safe boot migrations** — `migrate.ts` wraps the run in one transaction
  behind a `pg_advisory_xact_lock`; the web service runs them at boot so a
  redeploy shipping a new migration applies it even on a seeded DB. Closes the
  "frontend never runs migrations → schema skew" window.
- **Honest health/detection** — `/api/health` is liveness (always 200, rich
  body, reads `getIndexes()` fresh); `/api/freshness` is status-coded
  (`ok`/`syncing` → 200; `stuck`/`stale`/`schema_behind`/`degraded` → 503).
- **Bounded retry + backoff + escalation** — replaced the `lastTried`
  permanent-skip (which risked days of silent staleness on the few-times-a-week
  cadence) with exponential backoff; escalates to ERROR + `stuck` after
  `ATLAS_UPDATE_ESCALATE_AFTER` attempts.
- **Single-transaction snapshot read** — sha + doc/address rows read in one
  `sql.begin`; `docs.json` stamped with the in-snapshot sha so label matches
  content.
- **Sanity floor gate** — refuse a hot-swap to 0 docs / below
  `ATLAS_MIN_DOC_RATIO` of the live count; keep last-good.
- **Stuck alarm** — updater publishes `divergedSinceMs`; freshness distinguishes
  a benign `syncing` from a genuinely `stuck` updater.

Tunables: `ATLAS_STALE_SECONDS` (48h), `ATLAS_STUCK_SECONDS` (30m),
`ATLAS_MIN_DOC_RATIO` (0.5), `ATLAS_UPDATE_MAX_BACKOFF_MS` (30m),
`ATLAS_UPDATE_ESCALATE_AFTER` (3).

## Deferred — ② atomic publish via live-as-bundle (do with preview / PR #79)

**Problem.** The updater republishes artifacts to `dist/` non-atomically:
`docs.json` lands, then `build-graph` rewrites `graph.json`/`relations.json`
seconds–minutes later, then a file-by-file mirror. A browser loading mid-window
can fetch new `docs.json` + old `relations.json` (dangling edges / missing
nodes). Per-file temp+rename would fix truncated reads but not this cross-file
skew.

**Decision.** Don't build a throwaway temp+rename. The preview feature (PR #79)
already has the right primitive in `src/server/preview/cache.ts`: each atlas
version is a self-contained bundle at `<sha>/out/{docs,relations,glossary,
search-index,addresses.atlas}.json`, with `bundleReady(sha)`, allowlisted
`artifactPath(sha, name)`, an in-flight `skip` set, and LRU eviction.

**Target design.** Model the **live atlas as one more bundle** under the same
versioned scheme, served via a `current` pointer the updater flips atomically:

1. Promote the `<sha>/out/` layout + `bundleReady`/`artifactPath` from
   preview-only to the general artifact store.
2. Updater builds the new sha into `<newsha>/out/`; once `bundleReady`,
   atomically flip `current → <newsha>` (symlink rename, or a tiny pointer
   row/file resolved at serve time).
3. Static serving for the live atlas resolves the known artifact names through
   `current` (mirrors `handlePreview`'s per-artifact routing).

**Wins:** whole-set atomicity (never a torn cross-file read); A.2 "keep
last-good" becomes "don't flip the pointer" (instant rollback, previous bundle
still on disk); one serving mechanism for live + preview; natural substrate for
time-travel. The sanity floor gate and convergence logic from PR #70 stay; only
*where artifacts land and how they're published* changes.

**Note:** preview's sweeper already does "stale-vs-main eviction after the
updater hot-swaps main" and keys `PreviewMeta.baseAtlasCommit` off main's sha —
so preview already depends on knowing main's version. Live-as-bundle makes that
coupling explicit instead of implicit.

## Still open

- **Alert wiring (infra, not code).** Point an uptime monitor at
  `/api/freshness`; 503 pages. Threshold semantics already encoded in the status.
- **Embeddings-lane lag (accepted, unmonitored).** Structural sha can advance
  while embeddings trail (by design — a slow provider must not block structural
  sync), so new docs are briefly invisible to semantic search with no surfaced
  signal. Cheap improvement: add an embeddings-coverage field
  (`COUNT(embeddings) vs COUNT(docs)`) to the freshness snapshot.

## Merge coordination with PR #79 (futures)

- **Boot migrations collide.** Futures added a preview-gated, best-effort boot
  `runMigrations()`; PR #70 adds a general advisory-locked one. PR #70's
  supersedes — drop the futures-side call on merge.
- **Migration number collision.** Futures has both `006_history_metrics.sql`
  and `006_previews.sql`. Renumber one to `007`/`008` on merge (shifts
  `REQUIRED_SCHEMA`, which is just `migrationFiles().at(-1)`).
- Both branches rewrite `atlas-updater.ts` (~200 lines each) — expect a manual
  resolution; PR #70's failure-handling rewrite is the one to keep.
