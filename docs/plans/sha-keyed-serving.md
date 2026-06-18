# SHA-keyed serving for live atlas artifacts (Model B: per-SHA bundle dirs)

> **Status: IMPLEMENTED & verified** (tsc, oxlint, 421 vitest + 108 bun server
> tests, `build:bundle`, `vite build`, live-server curl: 200+gzip+`immutable`,
> 404 on bad-sha/non-allowlisted, HTML sha injection). As-built deltas from the
> plan below:
> - **Stale-`.gz` bug fixed as a side effect.** `publishBundle` regenerates each
>   artifact's `.gz` from the fresh bytes into the per-SHA dir, so the runtime
>   updater no longer leaves stale `.gz` next to a rebuilt `.json` (the old flat
>   path had this latent bug for gzip clients).
> - **Build-time publish is its own `pnpm build:bundle`** (`scripts/required/
>   build-bundle.ts`, bun) per the "each pass = own script" convention — wired
>   into `build`, `build:railway`, the Dockerfile (after `build:glossary`, before
>   `build:vite` so `vite` copies the per-SHA dir into `dist/`), and dev-preflight
>   (`ensureBundle`). `MAIN_BUNDLE_ROOT = public/atlas` everywhere (prod symlinks
>   public→dist, so build-time write + runtime write + serve all coincide).
> - **`keep: 2`** (swap-window buffer only).
> - **More loaders needed base-threading than the plan assumed.** `addresses.ts`
>   and `graph.worker.ts` hardcoded `BASE_URL`; all loaders now default to a
>   shared `liveAtlasBase()` (`src/lib/atlasBase.ts`) reading `window.__ATLAS_SHA__`.
>   `addresses.json` + `chain-state.json` stay flat (on-chain/shared).
> - **HTML token is `{{ATLAS_SHA}}`**, not `__ATLAS_SHA__` — the latter collides
>   with the `window.__ATLAS_SHA__` property name on first-occurrence replace.
> - **Force-forward on stale 404** implemented: `verify.ts` throws
>   `StaleAtlasError` on a 404 under `/api/atlas/`; `atlasBase.ts` `handledStale`/
>   `handledStaleMessage` reload once (workers post the error string; main-thread
>   loaders catch the typed error).


**Prerequisite to the docs split** (`docs-split.md`, shipped as docs-shallow /
docs-deep). Serve atlas artifacts from immutable, per-SHA bundle directories,
unifying the live
("main"/HEAD) atlas and previews under **one** bundle store and **one** serving
handler:

```
main/HEAD:   /api/atlas/<sha>/<name>.json     ← <ATLAS_BUNDLE_ROOT>/<sha>/<name>.json
preview:     /api/preview/<sha>/<name>.json   ← /tmp/previews/<sha>/out/<name>.json
```

Preview already works this way (`src/server/preview/cache.ts`: bundles under
`PREVIEW_DIR/<sha>/`, LRU keep-20). This plan **generalizes that machinery** so
main is "just another bundle" with a different root, retention count, and cache
policy — not a second, divergent mechanism.

## Why (problem with the status quo)

Live artifacts are served as **mutable** flat files under `BASE_URL`
(`/redlens/docs.json`) from `config.distDir`. The in-process updater
**overwrites `dist/*.json` in place** with each new SHA's bytes (`atlas-updater.ts`
refresh-from-db → mirror to dist). Same URL, different content. Consequences:

- **No immutable caching.** SW caches `docs.json` / `search-index.json` /
  `relations.json` as `StaleWhileRevalidate` (`vite.config.ts`, cache
  `atlas-data-large`) — a returning user is always one load-cycle stale.
- **Cache-busting dance.** `useAtlasVersion` detects loaded-commit ≠ live (mount
  `GET /api/health` + `/api/atlas-events` SSE) → "atlas updated ↻" pill → accept
  runs `reloadWithFreshAtlas()` in `Footer.tsx`, which must
  `caches.delete("atlas-data-large")` first or the notice loops.

Per-SHA immutable URLs remove all of this: a URL's bytes never change **and**
(within retention) never disappear, so it caches forever; freshness becomes
"fetch a different URL," learned from the SHA injected into the HTML.

## (a) Shared bundle store

Generalize `preview/cache.ts` into a store keyed by a small config object so the
same path/allowlist/LRU/gz logic serves both namespaces. Move it to a
namespace-neutral module (`src/server/bundle-store.ts`); `preview/cache.ts`
re-exports the preview instance for its existing importers.

```ts
export interface BundleStore {
  root: string;          // MAIN: <ATLAS_BUNDLE_ROOT>;  PREVIEW: /tmp/previews
  artifactSubdir: string;// MAIN: "" (flat <sha>/<name>);  PREVIEW: "out"
  keep: number;          // MAIN: 2 (swap-window buffer only);  PREVIEW: 20
  allowlist: Set<string>;
}
```

- `bundleDir(store, sha)`, `artifactPath(store, sha, name)`, `bundleReady`,
  `touch`, `remove`, `evictLru(store, skip?)` — all gain a `store` param;
  signatures otherwise identical to today's preview functions.
- **Allowlists** stay per-namespace. MAIN: `docs.json`, `search-index.json`,
  `relations.json`, `glossary.json`, `addresses.atlas.json` (the split later adds
  `docs-shallow.json` + `docs-deep.json`). PREVIEW keeps its current set
  (adds `meta.json`, `diff.json`, `patches.json`).
- **`artifactSubdir`** preserves preview's existing `<sha>/out/` layout untouched
  (it also keeps a `<sha>/src/` build scratch dir); MAIN writes flat
  `<sha>/<name>.json` per the target route shape. One helper, two layouts.
- `MAIN_BUNDLE_ROOT` resolves to the **served** artifact root: `config.distDir +
  "/atlas"` in prod (vite copies `public/` → `dist/`, and the updater mirrors
  there), `config.publicDir + "/atlas"` in dev. Namespacing under `atlas/` keeps
  the `<sha>` dirs from colliding with other dist contents and bounds the
  `evictLru` scan.

## (b) Emit per-SHA dirs + prune

A single shared seam — `publishBundle(store, sha)` — copies the freshly-built
**flat** artifacts into `<root>/<sha>/` (with their `.gz` siblings) and calls
`evictLru(store, skip=currentSha)`. Both entry points call it, so the per-SHA
emit lives in exactly one place:

- **Build time** (Dockerfile + local `pnpm build` + dev preflight): after the
  artifacts are written flat, `publishBundle(MAIN_STORE, atlasCommit)`. The flat
  copies are **kept** — they're still read by the server's boot `loadIndexes()`,
  by the `build-graph`/`build-glossary` subprocesses (which read `docs.json`),
  and by the cold-boot/dev fallback. Flat = internal + fallback; per-SHA dir =
  the immutable public surface.
- **Runtime** (`atlas-updater.ts`): after refresh-from-db regenerates flat
  `public/*.json` and mirrors to `dist/`, `publishBundle(MAIN_STORE, newSha)`.

**Prune safety:** `evictLru` already accepts a `skip` set (in-flight preview
builds). Pass the **current live SHA** in `skip` so HEAD's bundle is never
evicted while the HTML still advertises it. `keep` is only a **swap-window
buffer** — enough that loads already in flight when a bump lands don't 404 on the
SHA that was current a moment ago (`keep:2` suffices). It is **not** there to let
stale tabs keep running on an old SHA: open tabs are forced forward on drift (see
Freshness lifecycle), so we don't engineer continuity for pinned-but-old SHAs.

The updater's existing overwrite-in-place of flat files stays as-is (it feeds the
flat consumers above). `publishBundle` is purely additive.

## (c) One serving handler, two namespaces

Extract the raw artifact read into a shared `serveBundleArtifact(store, sha, name,
headers)` (path resolve → gzip negotiation → 404), reusing the gzip logic already
in `index.ts`'s fetch fallback. Both routes call it; only headers/policy differ:

- **`GET /api/atlas/:sha/:name`** (new, `src/server/atlas-static.ts`): validate
  `:sha` (`/^[0-9a-f]{40}$/i`) + `:name` (MAIN allowlist) → `serveBundleArtifact`
  with `Cache-Control: public, max-age=31536000, immutable`, **indexable** (no
  `noindex`). Because the SHA dir is retained, immutability is now *true* — no
  `409`/serve-if-current special case, no bump race.
- **`GET /api/preview/:sha/:name`** (existing `preview/handler.ts`): keeps its
  special endpoints (`events` build-driver, `diff.json` computation, `meta.json`
  pr_state overlay) and its `noindex` header; its plain-artifact branch now
  delegates to `serveBundleArtifact(PREVIEW_STORE, …)` instead of the inline
  `Bun.file` read.

Dispatch for `/api/atlas/` is added to `index.ts`'s fetch fallback, alongside the
existing `/api/preview/` dispatch (dynamic segments → not the static `routes`
object).

## HTML SHA injection + frontend base

The SPA learns the current SHA from the HTML so its first artifact fetch hits the
right immutable URL with no extra round-trip.

- `index.html` gains `<script>window.__ATLAS_SHA__="__ATLAS_SHA__";</script>`.
- **Prod** (`index.ts:145` serves `index.html`): string-replace `__ATLAS_SHA__`
  with `getIndexes().meta.atlasCommit` (empty if indexes not yet loaded). Serve
  HTML `no-cache` so the injected SHA is always current.
- The existing `<link rel="prefetch" href="/docs.json">` / preload hints in
  `index.html` point at the old flat URLs — rewrite them to the sha-keyed URL in
  the same injection pass, or drop the `docs.json` prefetch (it's fetched in the
  atlas worker anyway).
- **Frontend base** (`src/lib/dataSource.tsx`, `DEFAULT_SOURCE.base`):
  ```ts
  const sha = window.__ATLAS_SHA__;
  base: sha ? `/api/atlas/${sha}/` : import.meta.env.BASE_URL,
  ```
  Everything downstream (`docs.ts`, `atlas.worker`/`search.worker` via the worker
  `name`, `graph.ts`, `addresses.ts`) already consumes `base` — no change.
- Declare `window.__ATLAS_SHA__` in `src/vite-env.d.ts`.

## Dev parity + cold-boot fallback

With Model B the build **physically writes** `public/atlas/<sha>/…` in dev, so the
files exist — the question from earlier ("will dev have the SHA dirs?") is now
**yes**. To make dev exercise the real path end-to-end:

- **Vite dev plugin** (`transformIndexHtml`): read `atlasCommit` from local
  `public/docs.json` and substitute `__ATLAS_SHA__` (Vite serves `index.html` in
  dev, not the Bun injector). The existing `/api` proxy (`vite.config.ts:52`)
  forwards `/api/atlas/*` to the Bun server, whose `MAIN_BUNDLE_ROOT` in dev is
  `public/atlas` — so dev serves from real per-SHA dirs through the real handler.

**Empty-SHA fallback to flat `BASE_URL`** is retained for the cases where the SHA
isn't injected or indexes aren't ready — **not** for GH Pages (now only a redirect
stub to Railway, `deploy.yml`):

- **`DEV_NO_DB=1`**: reader serves flat disk artifacts, no updater.
- **Cold boot on Railway**: indexes not yet loaded → `atlasCommit` empty → inject
  empty → flat fallback until the next reload.
- Flat artifacts always exist (build + updater write them), so the fallback is
  free — no extra build step.

## SW caching simplifies

- `/api/atlas/<sha>/…` → `CacheFirst` long expiry (URLs are immutable), or drop
  from runtime caching and lean on the `immutable` HTTP header.
- Delete the `atlas-data-large` `StaleWhileRevalidate` rule and the
  `caches.delete("atlas-data-large")` hack in `Footer.tsx`.
  `reloadWithFreshAtlas()` becomes a plain `location.reload()` (new HTML → new SHA
  → fresh immutable URLs).
- `useAtlasVersion` is unchanged: detects SHA drift, shows the pill; reload "just
  works."

## Freshness lifecycle

The current SHA reaches the SPA two ways: the **HTML** (served `no-cache`, with
`window.__ATLAS_SHA__` injected from `getIndexes().meta.atlasCommit`) carries it
on any fresh load; the **`/api/atlas-events` SSE** (+ the `/api/health` mount
poll in `useAtlasVersion`, both unchanged) tells an already-running tab the live
SHA moved. Everything past "what SHA" is just URL construction —
`base = /api/atlas/<sha>/`, immutable.

- **Returning user (closed tab, stale cache):** re-requests the `no-cache` HTML →
  gets the current SHA → fetches `…/<newSha>/…`, URLs the cache has never seen →
  fresh on the first and only load. The old SWR "one cycle stale" problem is gone
  because the URL itself changed; orphaned `…/<oldSha>/…` entries just expire.
- **Open tab across a bump:** updater bumps → `publishBundle` + refresh → SSE
  `atlas-update` fires → `useAtlasVersion` sees drift → "atlas updated ↻" pill.
  The tab is **forced forward**, not kept on its old SHA: accepting the pill (or
  any sha-keyed fetch that 404s because the old dir was pruned) triggers a plain
  `location.reload()` → fresh HTML → new SHA → new immutable URLs. We deliberately
  do **not** build lazy-old-artifact fallback or guarantee the pinned SHA keeps
  serving; the old version is not a supported surface for a live tab.

## Files to change

| File | Change |
|---|---|
| `src/server/bundle-store.ts` (new) | generalized store: `BundleStore` config, `bundleDir`/`artifactPath`/`bundleReady`/`touch`/`remove`/`evictLru(store, skip)`, `publishBundle(store, sha)`, `serveBundleArtifact(store, sha, name, headers)`; export `MAIN_STORE` + `PREVIEW_STORE` |
| `src/server/preview/cache.ts` | re-export the PREVIEW store/instance from `bundle-store.ts`; keep `PreviewMeta` + preview-specific helpers |
| `src/server/preview/handler.ts` | plain-artifact branch delegates to `serveBundleArtifact(PREVIEW_STORE, …)` |
| `src/server/atlas-static.ts` (new) | `/api/atlas/:sha/:name` handler: sha + name validation, `serveBundleArtifact(MAIN_STORE, …)`, immutable + indexable headers |
| `src/server/index.ts` | dispatch `/api/atlas/` in fetch fallback; inject `window.__ATLAS_SHA__` into served `index.html` |
| `src/server/atlas-updater.ts` | call `publishBundle(MAIN_STORE, newSha)` after refresh-from-db + mirror |
| `scripts/required/build-index.mjs` (or `build-manifest.mjs`) | call `publishBundle(MAIN_STORE, atlasCommit)` after flat artifacts are written (build-time emit) |
| `src/server/config.ts` | `MAIN_BUNDLE_ROOT` (dist/atlas prod, public/atlas dev) + `ATLAS_BUNDLE_KEEP` |
| `index.html` | add `window.__ATLAS_SHA__` placeholder; fix/drop flat prefetch/preload hints |
| `src/lib/dataSource.tsx` | `DEFAULT_SOURCE.base` = sha-keyed when `window.__ATLAS_SHA__` set, else `BASE_URL` |
| `src/vite-env.d.ts` | declare `window.__ATLAS_SHA__` |
| `vite.config.ts` | dev plugin injecting `__ATLAS_SHA__` from `public/docs.json`; SW runtimeCaching → `CacheFirst`/immutable, drop `atlas-data-large` SWR |
| `src/components/Footer.tsx` | `reloadWithFreshAtlas()` → plain reload (no cache-delete) |

## Sequencing vs the split

1. Land this prerequisite. Main + preview serve from per-SHA immutable dirs via
   one store + one artifact server; SHA injected into HTML.
2. Then the docs-split (`docs-split.md`) adds `docs-shallow.json` +
   `docs-deep.json` to the MAIN allowlist; `publishBundle` emits them into the
   SHA dir automatically. The single-owner atlas-worker loading design is
   unaffected — it fetches `${base}docs-shallow.json` where `base` is sha-keyed.

## Not in scope

- SHA-keying `chain-state.json` / `addresses.json` — on-chain/shared, not
  atlas-derived; they stay flat under `BASE_URL` (and preview reuses main's).
- `manifest.json` — digests the flat artifacts (byte-identical to the SHA-dir
  copies); the `REPRO=1` reproducibility check stays on the flat output.
- A CDN in front of `/api/atlas/<sha>/…` — the immutable headers make it
  CDN-ready, but wiring a CDN is a separate deployment concern.
