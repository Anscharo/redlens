# Atlas artifact store — the worker publishes, every web instance reads

> **Status: PHASES 0–5 IMPLEMENTED.** Phases 0–3 shipped in PR #328
> (`92e71573`). Phases 4–5 (web hydrates from the store; search-index coupling
> reversed so publish precedes the in-memory swap) follow in this change.
>
> **Deploy ordering is load-bearing, not merge-ordering.** Do not deploy a web
> instance that refreshes from the store until the worker has completed ≥1
> successful `publish-artifacts: published N artifacts for <sha>` for the live
> sha. Shipping web first means `getArtifacts` returns `[]`, boot hydration
> never converges, and `/api/freshness` reports stuck while the process keeps
> serving the image-baked atlas. The updater's `storeHydratedSha` gate is the
> in-process safety net for that mistake; it does not replace waiting on the
> worker.
>
> Supersedes the never-written `atlas-runtime-freshness-buckets.md` that
> [atlas-runtime-freshness-inprocess.md](atlas-runtime-freshness-inprocess.md)
> cross-references as "the shared-store design". That reference (and its sibling
> `atlas-runtime-freshness.md`) point at files that do not exist — clean them up
> when this lands.

## The idea

Today every web instance **builds** its own copy of the atlas artifacts: on
drift it reads `atlas_doc_meta` out of Postgres, writes `docs.json`, spawns
`build-graph` + `build-glossary` + `build-oea-report`, re-serializes MiniSearch,
and publishes a per-sha bundle onto its own container disk.

The worker **already builds almost all of that and throws it away**
(`stepsFor("worker")` = `["index", "graph", "oea-report"]`, and `index` emits
`docs.json` + `search-index.json` + `addresses.atlas.json` + the depth split).
Only `glossary` is missing, and its opt-out comment says why: *"the worker's
product is Postgres rows, and sync.ts does not read glossary.json."*

So: have the worker publish the artifacts it already produces, and have each web
instance download them instead of rebuilding.

```
BEFORE                                  AFTER

worker cron (every 12 min)              worker cron (every 12 min)
  build index+graph+oea                   build index+graph+glossary+oea
  sync.ts → Postgres rows                 sync.ts → Postgres rows
  (artifacts discarded)                   PUBLISH artifacts → atlas_artifacts

web instance (per drift)                web instance (per drift)
  SELECT atlas_doc_meta                   SELECT atlas_artifacts WHERE sha=…
  write docs.json + split                 write them to disk
  spawn build-graph                       load indexes
  spawn build-glossary                    broadcast
  spawn build-oea-report
  writeSearchIndex()                    web instance (per REQUEST, new)
  mirror public/→dist/                    /api/atlas/<sha>/x.json
  refresh .gz siblings                      local hit → serve
  publishBundle()                           local MISS → read atlas_artifacts,
  broadcast                                   cache locally, serve
```

## Why (three payoffs, in the order they arrive)

**1. A live 404 bug, at one replica.** The updater swaps its in-memory indexes —
and therefore the sha it injects as `window.__ATLAS_SHA__` — *before* it
publishes the bundle. A page load in that window is pinned to a sha whose
artifacts are not on disk yet, 404s on `docs-shallow.json`, and
`atlasBase.ts` reads that as a pruned sha and force-reloads the page. Phase 0
removed the partial-bundle half of this; only a serve-path fallback (phase 2)
removes the rest, because it stops serving from depending on swapping at all.

**2. OOM headroom.** The build subprocesses plus the in-process MiniSearch
rebuild are the web container's peak-RSS event. Moving them to the worker is a
bigger OOM win than adding a second instance — and needs no second instance.

**3. Multi-instance becomes *possible*.** Not done here. See "What this does not
fix".

## Store choice: Postgres, not Railway Buckets (decided 2026-08-25)

Railway ships first-party [Storage Buckets](https://docs.railway.com/storage-buckets)
— private, S3-compatible, $0.015/GB-month with free requests and free bucket
egress — and Bun has a built-in `S3Client`, so this would need no npm
dependency. It was considered and rejected **for this workload**, on two
grounds that have nothing to do with cost (15 MB is $0.0002/month, and Railway
Volumes are disqualified outright since a volume attaches to a single service):

1. **Postgres gives a transaction; S3 does not.** A sha's artifact set lands
   atomically, so a reader can never see half of one. The S3 equivalent is a
   manifest-written-last convention — the same weaker pattern phase 0 just
   *removed* from the disk store.
2. **One consistency domain.** `sync_state.atlas_sha` is the drift signal the
   whole updater keys on. Keeping the artifacts in the same database makes "this
   sha is live" and "its artifacts exist" checkable against each other (see
   publish-artifacts.ts, which refuses to publish under a sha the pointer does
   not name). Splitting them introduces a second system that can disagree with
   the pointer — which is the exact failure this plan exists to fix.

Secondary: buckets would put a network dependency in `pnpm dev`'s deliberately
offline-capable preflight (no local emulator without adding MinIO to
docker-compose), and add four credentials × two services × each environment,
where `DATABASE_URL` is already wired on both.

**This is reversible and deliberately cheap to reverse.** `atlas-artifacts.ts`
is the only module that touches the table, behind a small API, and
`hydrateBundleFromStore` takes its fetcher injected and never imports the store.
Swapping the backing store is one module rewrite against an unchanged interface.
**Revisit when** retention grows past ~20 shas, preview bundles move to shared
storage, or DB backup/restore time starts to matter.

## Measured artifact sizes

Built at atlas `9ba9246`, gzip -9:

| Artifact | Raw | Gz | Published? |
|---|---:|---:|---|
| `docs.json` | 6.15 MB | 1.39 MB | **No** — server-internal, and rebuildable from `atlas_doc_meta` |
| `docs-deep.json` | 3.83 MB | 0.71 MB | yes (browser) |
| `search-index.json` | 3.51 MB | 1.07 MB | yes (browser) |
| `relations.json` | 1.53 MB | 0.31 MB | yes (browser) |
| `docs-shallow.json` | 1.02 MB | 0.23 MB | yes (browser) |
| `oea-report.json` | 0.44 MB | 0.05 MB | yes (browser) |
| `addresses.atlas.json` | 0.07 MB | 0.02 MB | yes (browser) |
| `glossary.json` | 0.05 MB | 0.02 MB | yes (browser) |
| `graph.json` | 4.31 MB | 0.64 MB | yes (server-internal, but expensive to build) |
| **published total** | **~14.8 MB** | **~3.05 MB** | |

At 5 retained shas that is ~15 MB of gzipped blobs in Postgres. Trivial.

`docs.json` is excluded because nothing fetches it (the browser gets the depth
split) and nothing reads main's per-sha copy off disk — the server's own indexes
read the flat `public/docs.json`, which `runRefreshFromStore` reconstructs
from `atlas_doc_meta ORDER BY ord` with `node_content_hash` intact.

## Phases

### Phase 0 — atomic publish *(done, unmerged)*

`publishBundle` stages into `<root>/.tmp-<sha>/` and renames into place; the
bundle dir is never observable half-written. `BundleStore.readyCore` replaces the
hardcoded docs.json completeness check. `docs.json` leaves MAIN's bundle,
`GZIP_ARTIFACTS`, and the Dockerfile gzip line. Prerequisite for phases 1–2: the
store needs a publish primitive that is atomic and idempotent before anything
else writes into it.

### Phase 1 — the artifact table

Migration `027_atlas_artifacts.sql` (026 is the current head on main — 025/026
landed as forum tables while this PR was open as 025):

```sql
CREATE TABLE IF NOT EXISTS atlas_artifacts (
  atlas_sha   TEXT        NOT NULL,
  name        TEXT        NOT NULL,   -- "docs-shallow.json", …
  gz          BYTEA       NOT NULL,   -- gzip -9 of the raw bytes
  raw_bytes   INTEGER     NOT NULL,   -- uncompressed length, for sanity checks
  sha256      TEXT        NOT NULL,   -- of the RAW bytes
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (atlas_sha, name)
);
```

Module `src/server/atlas-artifacts.ts` — the only place that talks to this table:

```ts
export interface StoredArtifact { name: string; gz: Buffer; rawBytes: number; sha256: string }

/** Publish one sha's artifact set. Idempotent (a sha's bytes are fixed). */
export function putArtifacts(atlasSha: string, items: StoredArtifact[]): Promise<void>;

/** Every artifact for a sha, or [] when the sha was never published. */
export function getArtifacts(atlasSha: string): Promise<StoredArtifact[]>;

/** Published shas, newest first. */
export function listArtifactShas(limit?: number): Promise<string[]>;

/** Drop all but the `keep` newest shas. Returns the shas removed. */
export function pruneArtifacts(keep: number): Promise<string[]>;
```

Notes for the implementer:

- Nothing in this schema uses `BYTEA` yet — **verify a real Buffer round-trip**
  through the driver (`src/server/db.ts`) before committing to it. If Bun's SQL
  driver mangles it, fall back to base64 `TEXT` and say so in the migration
  comment; do not leave it unverified.
- Write the whole set for a sha in ONE transaction. A half-published sha is the
  same failure class phase 0 just removed from the disk store.
- `putArtifacts` must be safe to call twice for the same sha (worker retries,
  redeploys). `ON CONFLICT DO NOTHING` — the bytes cannot legitimately differ.

### Phase 2 — serve on a local miss

`handleAtlasStatic` currently 404s when the sha dir is not on local disk. Make
the miss path hydrate from the store and cache locally on the way out:

```
GET /api/atlas/<sha>/<name>.json
  → serveBundleArtifact(MAIN_STORE, …)          hit → 200
  → miss: hydrateBundleFromStore(MAIN_STORE, sha, fetch)
      → wrote a bundle? re-serve → 200
      → nothing published for that sha → 404 (a genuinely pruned sha)
```

`hydrateBundleFromStore` lives in `bundle-store.ts` and takes the fetcher
**injected**, matching the codebase's DI convention (`TickDeps`, `BootDeps`,
`SpawnFn`) so it is testable without a database:

```ts
export type ArtifactFetch = (sha: string) => Promise<Array<{ name: string; gz: Buffer }>>;
export function hydrateBundleFromStore(
  store: BundleStore, sha: string, fetch: ArtifactFetch,
): Promise<boolean>;   // false = nothing published for that sha
```

It must reuse phase 0's staging + rename so a hydrate is as atomic as a publish,
must gunzip to write the flat `.json` **and** keep the `.gz` sibling (the serve
path prefers it), and must de-dupe concurrent hydrates of the same sha — a cold
instance can take a burst of requests for one sha and must not start N downloads.

Three things review added to that contract:

- **`evictLru` must skip in-flight stages.** Sweeping every `.tmp-*` as crash
  garbage was safe while `publishBundle` was the only writer (never concurrent
  with itself). Hydration breaks that: a burst of *different* cold shas — the
  crawler case the pin exists for — had each finishing hydrate deleting the
  others' still-writing stages. `stageIntoBundle` registers live stages;
  eviction skips them.
- **Hydrate verifies `sha256`/`rawBytes` before writing.** Gzip's CRC proves the
  container survived, not that it holds the right bytes, and a corrupt artifact
  cached as a complete bundle would be served forever — the `existsSync`
  short-circuit never re-fetches. Both fields are optional on `ArtifactFetch`,
  so a fetcher that cannot supply them still works, unverified.
- **Hydrate asks for only the names it can serve.** The store holds the union of
  every consumer's needs; pulling `graph.json` (~0.64 MB gz) per cold miss just
  to drop it is waste that scales with the number of cold instances. The filter
  is applied in SQL (`getArtifacts(sha, names)`), with the post-filter kept
  because an injected fetcher may ignore `names`.

**This phase alone fixes payoff 1 and is shippable on its own, at `replicas=1`.**

### Phase 3 — the worker publishes *(done)*

`glossary` is back in `PROFILES.worker` (it was opted out because sync.ts does
not read glossary.json; the worker now publishes it for the browser).
`scripts/required/publish-artifacts.ts` (`pnpm publish:artifacts`, sibling of
build-bundle.ts) gzips each name in `PUBLISHED_ARTIFACTS` from the build output,
`putArtifacts`, then `pruneArtifacts(config.atlasArtifactKeep)` — default 5, one
more than `atlasBundleKeep` so an instance pinned to a slightly older sha can
still re-hydrate it.

`PUBLISHED_ARTIFACTS` is **derived** from `MAIN_ALLOWLIST` plus `graph.json`, and
a test asserts every published name is produced by a step the worker profile
actually runs — so adding an artifact fails until someone declares its producer.

Two things the plan did not anticipate:

- **The worker's fast path skips the build**, so on the deploy that first ships
  publishing, `sync_state` is already current and nothing would ever be
  published until upstream next moved. `hasArtifacts(sha)` (a bounded existence
  probe, not a blob fetch) is now part of the early-exit gate — the same shape
  as the existing structural-integrity guard, and for the same reason: a
  matching pointer alone does not mean the rows are there.
- **`publish-artifacts.ts` refuses to publish** under a sha that is not what
  `sync_state` points at, or when any expected artifact is missing from the
  build output. Both would otherwise surface only as a 404 in a browser.

The worker's publish **fails the run** (phase 4): web instances no longer build
their own artifacts, so a missing publish is load-bearing.

### Phase 4 — the web stops building *(done)*

`runRefreshFromDb` → `runRefreshFromStore`: `getArtifacts(dbSha, PUBLISHED_ARTIFACTS)`
→ `writeStoredArtifacts(publicDir)` → reconstruct `docs.json` from `atlas_doc_meta`
in the same snapshot. Deletes the `atlas_addresses` read, the split writes, three
`spawn` calls, `dropStaleSearchIndex`, the `public/ → dist/` mirror, the `.gz`
refresh loop, `sameRealDir`, `groupAddrRowsToAtlas`, and the `updater` build-steps
profile. The drift poller, the backoff/escalation state machine, and the SSE
broadcast all stay: the updater shrinks, it does not disappear.

`docs.json` is the one artifact the web still writes itself, from
`atlas_doc_meta` — still needed by `readArtifactsFromDisk`.

`decide()` hydrates even when `live === db` until `storeHydratedSha` matches,
so a web deploy that races the first worker publish reports freshness stuck
instead of silently serving the image-baked atlas as healthy.

### Phase 5 — the search-index coupling, and the ordering *(done)*

The worker ships `search-index.json`. `refreshInPlaceFromDisk` no longer calls
`writeSearchIndex`; `rebuildFromDisk` loads the worker bytes via
`MiniSearch.loadJSON`. **Publish precedes the in-memory swap**, so
`window.__ATLAS_SHA__` cannot name a sha whose bundle is not on disk yet.
Hydrate-on-miss remains for cold instances.

The happy path still incrementally patches the live MiniSearch (same object
reference, cheap for a small delta). The coupling that forced publish-after-swap
was the *re-serialize after patch*, not the patch itself.

**Measured 2026-08-26** (synthetic MiniSearch sized to 3.53 MB
`JSON.stringify(toJSON())`, 20,737 docs, Bun on the agent host, 7 runs,
median):

| Path | Median |
|---|---:|
| `MiniSearch.loadJSON` (3.53 MB) | 148 ms |
| Incremental `replace` of 200 docs | 30 ms |
| `addAll` from scratch (same N) | 2467 ms |

`loadJSON` is cheap enough to be the fallback (`rebuildFromDisk` already used
it) and ~16× faster than rebuilding MiniSearch from docs. The incremental
patch remains the happy path because it is still ~5× faster for a small delta
*and* keeps the same object reference. The coupling that forced
publish-after-swap was re-serializing after the patch, not the patch itself.

## What this does NOT fix

Multi-instance stays blocked on work outside this plan:

- **Previews** are entirely local: `preview/build.ts`'s `inflight` Map is both
  the build-dedup and the SSE hub, and `bundleReady` is an `existsSync` against
  `/tmp/previews/<sha>`. The storage half would port (both stores already share
  `BundleStore`); the build coordination needs a DB lock plus `LISTEN/NOTIFY`.
- **Per-process counters** still multiply by N: `chat/concurrency.ts`,
  `config.sseMaxClients`, `config.previewMaxConcurrentBuilds`.
- **Per-instance RAM is unchanged.** Each instance still holds the whole
  `Indexes`. This plan removes the build *spike*, not the resident set.

Also unchanged: `window.__ATLAS_SHA__` is injected per instance, so two
instances mid-drift serve HTML pinned to different shas. After phase 2 both are
servable by every instance, so it is a staleness difference, not a 404.

## Verification

- Round-trip test for the store: publish → read → byte-identical, including a
  re-publish of the same sha.
- `hydrateBundleFromStore` against a fake fetcher: cold miss hydrates, second
  request hits local disk, unknown sha returns false, concurrent requests for
  one sha download once.
- Phase 4: `bun test src/server`, and a real drift cycle in `pnpm dev`.
- Phase 5: `loadJSON` vs incremental patch timing recorded in the phase-5 section.
