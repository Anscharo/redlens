# Atlas Freshness — Alternative B: Shared Store (Railway Buckets)

**Status: DESIGN / alternative.** Companion to [atlas-runtime-freshness.md](atlas-runtime-freshness.md)
(the redeploy design) and [atlas-runtime-freshness-inprocess.md](atlas-runtime-freshness-inprocess.md)
(the in-process design). This is the **most scalable** of the three: the
generated artifacts live in a **Railway bucket** (object storage), decoupled
from the container image, and the web service hot-swaps from the bucket without
a restart.

## The idea

Split the **data plane** out of the container image. A build-and-upload job
regenerates the data artifacts and writes them to a Railway bucket; the web
server reads them from the bucket at boot/reload and hot-swaps its in-memory
indexes; the browser fetches the same artifacts from the bucket for its
client-side search. The container image holds **only app code** and rebuilds
only when *code* changes.

```
 ┌─ build-and-upload job (cron-triggered or scheduled) ───────┐
 │  git fetch origin/main → build data artifacts              │
 │  upload to Railway bucket (manifest-versioned, by sha)     │
 │  POST <web>/internal/reload (token)                        │
 └────────────────────────────────────────────────────────────┘
                 │ writes                         │ pokes
                 ▼                                ▼
        ┌─ Railway bucket ─┐            ┌─ WEB SERVICE ─────────────┐
        │ docs.json        │◄── read ───│ /internal/reload: refetch │
        │ search-index.json│   (boot/   │   from bucket → hot-swap  │
        │ graph.json       │   reload)  │   in-memory indexes       │
        │ relations.json   │            │ (no restart)              │
        │ glossary,history │            └───────────────────────────┘
        └──────────────────┘                       ▲
                 │ public read (CDN-fronted)        │ /health → live sha
                 ▼
        BROWSER: client-side search fetches the same blobs
                 (manifest-versioned URLs; same code, untouched)
```

Railway buckets are a first-class project primitive (the project's
`status --json` exposes a `buckets` field), so no external object store (R2/S3)
is needed.

## Why this leaves client-side search untouched

The browser downloads the **same** `docs.json` + `search-index.json` and runs
the **same** in-worker MiniSearch. Only the *origin* changes (a bucket URL
instead of the app's static dir). Same files, same code, same speed — the
beloved feature is preserved; it just reloads its index when (and only when) the
content hash changes.

## Versioning keeps it fast *and* fresh

Artifacts are **immutable and content-addressed** — `manifest.json` already
carries a sha256 of each. Store them in the bucket under content-hashed paths:
immutable, infinitely cacheable, instant cache-bust the moment the hash changes.
The SPA reads the small manifest and refetches only the artifacts whose hash
moved. "Load once, super fast" survives.

## Postgres holds no blobs

The 5–10 MB artifacts never touch Postgres. PG keeps only what's relational /
queryable: `atlas_doc_meta`, embeddings (pgvector), addresses, history rows, and
the chat tables. Object storage does what it's good at (large immutable blobs,
CDN delivery); PG does what it's good at (rows, FTS, vectors). This is the clean
resolution of the "multi-MB blobs in Postgres" worry.

## The hard parts

1. **The artifact-generation job needs the full build toolchain + the atlas
   submodule + bucket *write* creds.** This is the biggest change: the redeploy
   plan's cron is deliberately *tiny* (no toolchain). Here, *something* must pull
   the atlas, run the build scripts, and upload. Either the cron grows into that
   job, or a **third service** owns it.
2. **An `/internal/reload` endpoint + shared token comes back.** The redeploy
   design deletes this; here the server needs it to re-read the bucket and
   atomically hot-swap. (Build a new index set, then swap the reference.)
3. **Bucket access in three places, least-privilege each:** the job → *write*;
   the web server → *read* (boot/reload); the browser → public read of the
   artifact URLs (ideally CDN-fronted).
4. **CDN / latency check:** confirm Railway buckets are CDN-fronted (or
   acceptably fast from your users' regions) for the 5–10 MB downloads — that's
   the one thing that could affect *perceived* client-side-search load time
   (though no worse than today's single-region app-served files).

## What this does to the setup (vs DEPLOYMENT.md)

- **Added:** a Railway bucket; bucket creds in three places (job write / server
  read / browser public read); an `/internal/reload` endpoint + token; an SPA
  artifact base URL + manifest-versioned fetch.
- **Changed:** the cron's action shifts from "trigger redeploy" → "run the
  build-and-upload job, then `POST /internal/reload`." Drift detection
  (`ls-remote` vs `/health.atlas_sha`) is unchanged. The artifact job is the new
  heavy thing (toolchain + submodule + write creds).
- **Removed for data updates:** no redeploy on atlas change (the web image
  rebuilds only on code changes); `NO_CACHE` and the redeploy mutation drop out
  of the data hot path.
- **Unchanged:** Postgres + pgvector + chat env; **client-side search** (origin
  only); `/health` (reports the live sha, advanced after each reload).
- **Net:** more moving parts than today (bucket + job + reload endpoint/token +
  SPA fetch config), but data updates are incremental and restart-free, and the
  image rebuilds only on code change.

## File-touch sketch

- New `railway` bucket + a build-and-upload job (a service or a beefed-up cron)
  with the build toolchain + submodule + bucket write creds.
- `src/server/index.ts` — fetch artifacts from the bucket at boot; add
  token-guarded `/internal/reload` that refetches + hot-swaps.
- `src/server/indexes.ts` — load from the bucket; make the state swappable.
- Frontend artifact loaders (`src/lib/docs.ts`, `src/lib/addresses.ts`,
  `src/lib/glossary.ts`, `src/workers/search.worker.ts`,
  `src/workers/graph.worker.ts`) — fetch from the bucket base URL via the
  manifest instead of `BASE_URL`-relative static paths.
- `src/server/config.ts` — bucket endpoint/creds, artifact base URL, reload token.

## When to choose this

Best fit when: you need **horizontal scaling** (multiple web replicas all read
the same bucket and reload independently), you want data fully decoupled from
deploys, and you can absorb the extra setup (bucket + job + reload + creds). It's
the only one of the three that scales past a single replica without further
rework — at the cost of being the most plumbing.
