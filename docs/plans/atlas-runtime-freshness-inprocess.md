# Atlas Freshness — Alternative A: In-Process Self-Updater

**Status: DESIGN / alternative.** Companion to [atlas-runtime-freshness.md](atlas-runtime-freshness.md)
(the redeploy design) and [atlas-runtime-freshness-buckets.md](atlas-runtime-freshness-buckets.md)
(the shared-store design). This is the **simplest** of the three: the web
service updates its own data plane **in place**, with no second service, no
buckets, no Railway API, and no restart.

## The idea

A lightweight checker inside the running web process detects when the upstream
atlas advances, spawns a build **subprocess** to regenerate the data artifacts
on the container's own disk, then **hot-swaps** the in-memory indexes. The
browser keeps fetching `docs.json` / `search-index.json` from the same origin
with the same code — they're just fresher. **Client-side search is untouched.**

```
WEB SERVICE (single long-running process)

  ┌─ checker (timer or small worker, every N min) ─────────────┐
  │  git ls-remote origin main  vs  in-memory atlas_sha        │
  │  (same process — no /health HTTP, no cross-service call)   │
  │  drift?  no → sleep                                        │
  │          yes → spawn build subprocess ↓                    │
  └────────────────────────────────────────────────────────────┘
                         │ Bun.spawn (isolated, niced)
                         ▼
  ┌─ build subprocess ─────────────────────────────────────────┐
  │  git -C vendor/next-gen-atlas fetch origin main && checkout │
  │  build:index + build:graph + glossary + history + manifest  │
  │  (NO vite / tsc — code didn't change; data artifacts only)  │
  │  write to temp dir → atomic rename/swap                     │
  └────────────────────────────────────────────────────────────┘
                         │ on success
                         ▼
  main process: reload in-memory indexes from new on-disk files
                + sync:atlas (PG rows) + spawn sync:embeddings
                → /health now reports the new atlas_sha (no restart)
```

Because nothing restarts, in-flight MCP and chat connections survive — the
no-interrupt property the chat work wants, for free.

## Why it only rebuilds data artifacts

`build:railway` is `build-index` + `build-graph` + `build-manifest` + `build:ts`
+ `build:vite`. On an atlas change **the code is unchanged**, so the SPA bundle
and `tsc` don't need rerunning — only the data artifacts (`docs.json`,
`graph.json`, `relations.json`, `search-index.json`, glossary, history,
manifest). That makes the in-process build meaningfully lighter than a full
deploy build.

## Incremental index updates — don't rebuild, mutate

The 316 MB peak measured for `build:index` is the cost of building the **whole**
MiniSearch index from scratch. But the steady case is *a handful of changed docs
per update*, and the in-memory structures support **per-document mutation**, so
the live index can be patched instead of rebuilt:

- **MiniSearch** ([API](https://lucaong.github.io/minisearch/classes/MiniSearch.MiniSearch.html))
  exposes `add`/`addAll`, `remove`/`removeAll`, `discard`/`discardAll`,
  `replace`, and `vacuum`. For an update: `replace(newDoc)` per changed doc (it
  discards the old version by id and adds the new), `add` for new docs,
  `discard(id)` for deletions, then a periodic `vacuum()`. Caveat: `remove()`
  needs the *unchanged original* document (it decrements term frequencies) — the
  server holds the old `docMap` so `remove(oldDoc)+add(newDoc)` is possible, but
  `replace`/`discard` (id-only) are simpler and can't corrupt the index.
- **docMap** — update the `Map` entries for the changed UUIDs.
- **graphology** — the global half: recompute the edges *incident to* the changed
  docs (relation extraction for just those nodes, both directions) and apply with
  `addNode`/`dropNode`/`addEdge`/`dropEdge`. Heavier than MiniSearch's clean
  per-doc story, but still O(changed docs), not O(corpus).

**Computing the changed set** is simpler than a `git diff`: compare per-doc
`content_hash` before vs after — which is *exactly what `sync.ts` already does*
(`SELECT id, content_hash FROM atlas_doc_meta` → diff against the freshly-parsed
hashes, ~lines 68–76, where today it only *counts* inserted/updated/deleted). The
incremental updater just consumes those sets: `added = new − old`,
`removed = old − new`, `changed = in both, hash differs`. Notes:

- Compare **hashes, not just ids** — an id-only comparison misses *modifications*
  (the common case). Reuse the shared `contentHash(node)` helper (it hashes
  title+content, excluding doc_no/parent/depth, so a pure renumber doesn't churn).
- Old hashes can come from the **in-memory `docMap`** (nodes already carry
  `contentHash`) or from `atlas_doc_meta`; new hashes from the re-parse. PG isn't
  required for the index diff — it's a pure before/after-`docs.json` comparison.
- The full re-parse this implies is cheap; the parse was never the expensive part
  — the MiniSearch *index build* is, and that's what we skip. No git plumbing,
  file→UUID mapping, or delete-via-old-content handling.

**Why this matters:** incremental mutation makes the common-case update **cheap
enough to run in the main process** — no 316 MB subprocess spike, no
`nice`/headroom gymnastics — which largely neutralizes the resource-contention
downside (constraint 2 below). The full `build:index` subprocess becomes a
**cold-start / fallback** path (first boot, or a diff too large to be worth
patching), not the steady path. After patching in memory, re-serialize
`search-index.json` (MiniSearch `toJSON`) + `docs.json` to disk for the browser.

## The three constraints (where the real work is)

1. **The build toolchain + atlas git repo must survive into the *runtime*
   image.** Today the build runs in Railway's *builder*; the runtime image may
   not keep `git`, the submodule's live `.git`, or the build-script deps. The
   image setup (`nixpacks.toml`) must deliberately **keep** them so the running
   container can `fetch` + rebuild. (This is the inverse of the redeploy plan,
   which works to keep that toolchain *out* of the cron.)
2. **The build runs inside the serving container** → CPU/memory contention with
   live MCP + chat traffic. Mitigations:
   - **Spawn a subprocess, not a worker thread** — an OOM/crash kills the child,
     not the server.
   - `nice` the subprocess; serialize so only one build runs at a time.
   - Size the service with **memory headroom** for the build spike (graph +
     MiniSearch index over ~10k nodes is not free).
   - **Best mitigation: don't full-rebuild** — incremental mutation (above)
     patches the live index per changed doc, so the ~316 MB / ~600 MB-peak spike
     only applies to the cold-start/fallback full rebuild, not steady updates.
3. **Single-replica by construction.** Each replica has its own disk + memory,
   so N replicas would self-update at different moments and briefly serve
   different `atlas_sha`. The service is `numReplicas: 1` today, so this is fine
   — but the design is **coupled to one replica**; horizontal scaling later
   would force a shared store back in (see the buckets alternative).

**Atomic publish.** Build into a temp dir, then atomic-rename/swap, with
manifest-versioned filenames, so the browser never catches a half-written file
and the server reloads a complete set. Regenerate into the directory the server
*reads* its in-memory indexes from **and** the directory it *serves* to browsers
(today `public/` vs `dist/` — unify or copy across).

**Persistence is a non-issue.** Artifacts on the ephemeral FS are fine to lose
on restart: the image ships the last-built artifacts, and the checker
re-detects drift and rebuilds within one interval. No volume needed.

## What this does to the setup (vs DEPLOYMENT.md)

- **Removes:** the entire cron service, the Railway project token, the Railway
  API redeploy call, and any bucket. Drift→update is all in-process.
- **Changes:** the web image must carry the toolchain + submodule-as-git-repo
  (the one config change with teeth); give the service **memory headroom**; add
  an updater **interval + on/off env flag**.
- **Unchanged:** Postgres + pgvector + chat env; **client-side search**;
  `/health` (still reports the live in-memory sha, now advanced after each
  in-place swap).
- **Net:** from "two services + token + Railway API" down to **one
  self-updating service, zero new credentials.**

## File-touch sketch

- `src/server/index.ts` — start the checker after `Bun.serve` is listening
  (behind an env flag); on drift, spawn the build subprocess; on success, call a
  reload that re-reads artifacts and atomically swaps the in-memory state.
- `src/server/indexes.ts` — make the loaded state **swappable** (build a new
  index set, then atomically replace the module-level reference).
- New `scripts/required/refresh-atlas-build.mjs` — the subprocess entry: fetch
  `origin/main`, run the data-artifact builds (no vite/tsc), atomic-publish.
- `nixpacks.toml` — keep `git`, the submodule `.git`, and build-script deps in
  the runtime image; do not prune them after the build phase.
- `src/server/sync-embeddings.ts` — add retry/backoff (shared with the other
  designs); the reload kicks it after a successful artifact rebuild.

## Build order (scaffold landed 2026-06-01)

Ship the feature on **full rebuild + swap first**; the incremental patch is a
later optimization, because you cannot prove a doc delta is edge-free without
running the relation extraction that *is* the graph reconcile — so "doc-only →
patch, else → rebuild" collapses to "always rebuild" until reconcile exists.

1. **DONE — swap primitives + diff/patch units** (`src/server/indexes.ts`,
   `src/server/atlas-refresh.ts`, `src/server/atlas-refresh.test.ts`):
   - `buildIndexes(docs, entities, edges, meta)` — pure builder extracted from
     `loadIndexes`.
   - `setIndexes(ix)` / `rebuildFromDisk()` — atomic swap; `rebuildFromDisk`
     re-reads regenerated artifacts and advances `meta.atlasCommit` automatically.
   - `diffDocs` / `patchDocs` — built + unit-tested, **unwired** (the optimization
     half; `patchDocs` is synchronous = atomic on the event loop).
1b. **DONE — server `loadJSON` (drop dead `storeFields`).** The server deserializes
   the prebuilt `search-index.json` instead of `addAll`-rebuilding (matches the
   frontend). NOTE: not a boot-memory win (~270 vs ~247 MB, noise) — its value is
   the dead-config cleanup + positioning the server to OWN/re-serialize the index
   for step 4.
2. **DONE — the updater loop, on full-rebuild+swap** (`src/server/atlas-updater.ts`,
   `atlas-updater.test.ts`, `scripts/required/refresh-atlas-build.mjs`, wired in
   `index.ts` behind `ATLAS_UPDATE_ENABLED`). Checker compares `ls-remote origin
   main` vs `ix.meta.atlasCommit`; on drift spawns the build subprocess (fetch
   `origin/main` → regenerate data artifacts), then `rebuildFromDisk()` (advances
   `meta.atlasCommit`) + kicks `sync:atlas`/`sync:embeddings`. Pure `decide()` holds
   the convergence guard (built-but-didn't-advance → `lastTried`, stop hammering;
   transient failure → retry). Self-scheduling timer = no overlapping ticks.
   Verified: typecheck, unit tests, and a full **integration smoke** (2026-06-02)
   — staged drift (built at the older submodule commit), ran one real cycle, and
   confirmed all 5: drift→build, `refresh-atlas-build` exit 0, live converged to
   upstream, no re-trigger, and **`dist/docs.json` actually changed** (the
   `public/`→`dist/` mirror fix). Submodule state restored after.
3. **DONE — image + ops.** `sync-embeddings.ts` now has retry/backoff (transient
   batch failures retry 3× w/ exp backoff, then skip — stale, retried next run —
   never aborting the reconcile). `nixpacks.toml` documents the in-process runtime
   requirements (`git` + submodule `.git` + deps must survive; `ATLAS_UPDATE_ENABLED`
   toggles). Memory: size the instance ~1 GB for the ~600 MB rebuild peak (per the
   measured numbers in the design memory). The one item needing a live deploy to
   confirm: that the submodule's `.git` actually survives into the runtime image.
4. **DONE — subprocess search-index shrink (the in-place path), integration-verified
   (2026-06-02).** The updater now spawns `refresh-atlas-build` with
   `BUILD_SKIP_SEARCH_INDEX=1` (subprocess emits `docs.json`/`graph.json`/etc.
   WITHOUT the ~316 MB index and drops any stale `search-index.json`), then the
   server runs `refreshInPlaceFromDisk` (`atlas-refresh.ts`): `diffDocs` +
   `patchDocs` the live MiniSearch, rebuild graphology wholesale from the fresh
   `graph.json` and reassign in place, advance `meta`, and `toJSON` the patched
   index to `public/`+`dist/` for the browser. All synchronous = atomic; the new
   graph is built into locals *before* mutating so a malformed `graph.json` can't
   leave `ix` half-updated; `rebuildFromDisk` (full addAll swap) is the fallback on
   any in-place error. This is **NOT graph-gated** — the index is edge-independent;
   the graph stays correct because the subprocess still fully rebuilds `graph.json`.
   **Subprocess peak ~316 MB → ~180 MB.** Smoke (drift f5d4d29→7fa69a6) confirmed
   all 11: subprocess dropped the index, in-place delta `+27 ~55 -2`, converged,
   server re-wrote `search-index.json` to both dirs, 672 search hits with **0
   orphans**, and the written index round-trips via `loadJSON`.
5. **LATER — incremental graph build (the real hard part).** The ~180 MB floor is
   `build-graph`'s relation extraction, which IS edge-coupled/global. Making *that*
   incremental needs per-node relation extraction + reconcile; until then the
   subprocess fully rebuilds `graph.json` each update.

## When to choose this

Best fit when: single replica is acceptable, updates are infrequent (≤ ~1/day),
no-interrupt updates matter (chat), and you want the **least operational
surface** — one service, no tokens, no buckets. Trade: build load + toolchain
live in the serving container, and you forgo horizontal scaling without a later
shared-store migration.
