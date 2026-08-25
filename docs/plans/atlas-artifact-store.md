# Atlas artifact store — the worker publishes, every web instance reads

> **Status: PLAN.** Phase 0 (atomic publish) is implemented on
> `claude/atomic-bundle-publish`; phases 1–5 are unbuilt.
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
read the flat `public/docs.json`, which `runRefreshFromDb` already reconstructs
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

Migration `025_atlas_artifacts.sql` (024 is the current head):

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

**This phase alone fixes payoff 1 and is shippable on its own, at `replicas=1`.**

### Phase 3 — the worker publishes

Add `glossary` to `PROFILES.worker` in `scripts/lib/build-steps.mjs`, then a
publish step in `scripts/required/atlas-worker.mjs` after `sync.ts`: gzip each
published artifact from the build output, `putArtifacts`, `pruneArtifacts`.

### Phase 4 — the web stops building

`runRefreshFromDb` → `runRefreshFromStore`: `getArtifacts(dbSha)` → write to
`publicDir` → load indexes → broadcast. Deletes the `atlas_doc_meta` /
`atlas_addresses` read, the docs.json + split writes, three `spawn` calls,
`dropStaleSearchIndex`, the `public/ → dist/` mirror, the `.gz` refresh loop,
`sameRealDir`, and `groupAddrRowsToAtlas` — most of `atlas-updater.ts`'s 641
lines. The drift poller, the backoff/escalation state machine, and the SSE
broadcast all stay: the updater shrinks, it does not disappear.

`docs.json` is the one artifact the web still writes itself, from
`atlas_doc_meta` — unchanged code, still needed by `readArtifactsFromDisk`.

### Phase 5 — the search-index coupling, and the ordering

`refreshInPlaceFromDisk` calls `writeSearchIndex` because the updater's build
sets `BUILD_SKIP_SEARCH_INDEX=1`: the server deliberately owns the index and
patches its live MiniSearch incrementally. **That is why publish must follow the
swap**, and therefore why the phase-2 fallback is the only way to close the 404
without touching this.

Once the worker ships `search-index.json`, the web can load it verbatim —
`readArtifactsFromDisk` already prefers a serialized index. Then publish can
precede the swap and the window closes at the source.

**Measure before committing:** `MiniSearch.loadJSON` over 3.5 MB on every atlas
update, versus patching only the changed docs. The incremental patch exists
because someone decided it was worth it; this phase reverses that judgement and
needs a number, not an assumption.

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
- Phase 5: a timing number for `loadJSON` vs incremental patch, recorded here.
