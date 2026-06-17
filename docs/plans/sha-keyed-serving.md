# SHA-keyed serving for live atlas artifacts

**Prerequisite to the docs-meta / docs-content split** (`docs-split.md`). Move
the live atlas artifacts from mutable flat URLs to immutable, SHA-keyed URLs:

```
/redlens/docs.json                  →  /api/atlas/<sha>/docs.json
/redlens/search-index.json          →  /api/atlas/<sha>/search-index.json
/redlens/relations.json             →  /api/atlas/<sha>/relations.json
/redlens/glossary.json              →  /api/atlas/<sha>/glossary.json
/redlens/addresses.atlas.json       →  /api/atlas/<sha>/addresses.atlas.json
```

This mirrors the preview convention already in production
(`/api/preview/<sha>/<name>.json`, `src/server/preview/handler.ts`) and is the
URL scheme the docs-split assumes — once it lands, `docs-meta.json` /
`docs-content.json` are just two more names in the allowlist.

## Why (problem with the status quo)

Live atlas artifacts are served as **mutable** static files under `BASE_URL`
(`/redlens/docs.json`) from `config.distDir`. When the in-process updater
advances the atlas at runtime, it **overwrites `dist/*.json` in place** with the
new SHA's bytes (`atlas-updater.ts` refresh-from-db → mirror to dist). Same URL,
different content. The consequences we carry today:

- **No immutable caching.** The SW caches `docs.json` / `search-index.json` /
  `relations.json` as `StaleWhileRevalidate` (`vite.config.ts` runtimeCaching,
  cache `atlas-data-large`). A returning user is always one load-cycle stale.
- **Manual cache-busting dance.** `useAtlasVersion` detects the loaded commit ≠
  live (mount `GET /api/health` + `/api/atlas-events` SSE) and shows an "atlas
  updated ↻" pill. Accepting it runs `reloadWithFreshAtlas()` in `Footer.tsx`,
  which must `caches.delete("atlas-data-large")` before reload or the SW re-serves
  the stale file and the notice loops forever.

Immutable SHA-keyed URLs remove all of this: a given URL's bytes never change, so
it caches forever; freshness becomes "fetch a different URL", learned from the
SHA the server injects into the HTML.

## Server

### New route: `GET /api/atlas/:sha/:name`

Dispatched from the `index.ts` fetch fallback (dynamic segments, like the preview
handler — not the static `routes` object). New handler module
`src/server/atlas-static.ts`:

- Validate `:sha` against `/^[0-9a-f]{40}$/i` and `:name` against an **allowlist**
  (the browser artifact set — see below). Anything else → 404.
- Serve the bytes from `config.distDir` (reusing the existing gzip `.gz`
  negotiation already in the fetch fallback) with
  `Cache-Control: public, max-age=31536000, immutable`.

### Correctness model for the SHA guard

On disk there is only **one** generation of each artifact — the current live SHA
(the updater overwrites in place). A request for an *older* sha must never be
answered with the *current* sha's bytes, or the immutable cache contract breaks.

**Recommended (model A — serve-if-current, else reload):** compare `:sha` to
`getIndexes().meta.atlasCommit`.
- match → serve bytes, immutable.
- mismatch (client tab predates a runtime bump) → `409 Conflict` (or 410). The
  client treats this as "your SHA is stale" and reloads `index.html`, which
  re-injects the new `window.__ATLAS_SHA__` (below). This reuses the exact reload
  path the SSE pill already drives — no stale bytes ever served under a sha URL.

**Alternative (model B — retain a ring of recent generations):** keep the last
N sha generations on disk (`dist/atlas/<sha>/…`) so open tabs survive a bump
without a hard reload. Costs disk + updater bookkeeping; unnecessary for a
single-replica hot-swap deployment. **Deferred** unless mid-session reloads prove
disruptive.

### SHA injection into `index.html`

`index.html` is already served dynamically (`index.ts:145`). Inject the live sha
so the SPA's first artifact fetch targets the correct immutable URL with no extra
round-trip:

- Add a placeholder script in `index.html`:
  `<script>window.__ATLAS_SHA__="__ATLAS_SHA__";</script>`
- On each HTML serve, string-replace `__ATLAS_SHA__` with
  `getIndexes().meta.atlasCommit` (fall back to empty string if indexes aren't
  loaded yet). Cache HTML `no-cache` so the injected sha is always current.
- The existing `<link rel="prefetch" href="/docs.json">` / preload hints in
  `index.html` point at the **old flat URLs** and would warm the wrong cache
  entry. Either rewrite them to the sha-keyed URL during the same injection pass,
  or drop the `docs.json` prefetch (it's fetched inside the atlas worker anyway).

### Updater interaction

No change to the rebuild path: the updater still regenerates `dist/*.json` in
place and updates `getIndexes().meta.atlasCommit`. After the swap, new HTML serves
the new sha; previous-sha immutable URLs now 409 (model A), and open tabs reload
via the existing SSE pill.

## Frontend

The data layer already fetches every artifact as `${base}<name>.json` and threads
`base` through `dataSource.tsx` (live = `BASE_URL`, preview =
`/api/preview/<sha>/`, passed into workers via the worker `name`). So the change
is almost entirely **one line of base resolution**:

```ts
// dataSource.tsx — DEFAULT_SOURCE.base
const sha = (window as any).__ATLAS_SHA__;
base: sha ? `/api/atlas/${sha}/` : import.meta.env.BASE_URL,
```

- **GH Pages / static-host fallback:** there is no backend on GH Pages, so no
  `/api/atlas/` route and no sha injection → `window.__ATLAS_SHA__` is empty →
  base falls back to `BASE_URL` and the flat static files are served as built.
  This fallback MUST be preserved.
- **`window.__ATLAS_SHA__` typing:** declare it in `src/vite-env.d.ts`.
- Everything downstream (`docs.ts`, `atlas.worker`, `search.worker`, `graph.ts`,
  `addresses.ts`) is unchanged — they consume `base`.

### Which artifacts are sha-keyed (allowlist)

Per-SHA (move to `/api/atlas/<sha>/`): `docs.json` (later `docs-meta.json` +
`docs-content.json`), `search-index.json`, `relations.json`, `glossary.json`,
`addresses.atlas.json`.

**Stay flat under `BASE_URL`** (not atlas-content-derived / shared):
- `chain-state.json` — on-chain snapshot, shared across atlas versions and
  preview; fetched off `BASE` in `Footer.tsx`, not the data-source base.
- `addresses.json` — on-chain enrichment (chainlog/Etherscan), not atlas-keyed.
- `manifest.json`, app JS/CSS — already content-hashed by Vite.
- `/api/health`, `/api/atlas-events` — control plane, never sha-keyed.

### SW caching simplifies

Immutable sha URLs collapse the runtime-caching rules:
- `/api/atlas/<sha>/…` → `CacheFirst` with a long expiry (URLs never change), or
  drop from runtime caching entirely and lean on the HTTP `immutable` header.
- Delete the `atlas-data-large` `StaleWhileRevalidate` rule and the
  `caches.delete("atlas-data-large")` hack in `Footer.tsx` —
  `reloadWithFreshAtlas()` becomes a plain `location.reload()` (new HTML → new sha
  → fresh immutable URLs).
- `useAtlasVersion` is unchanged: it still detects sha drift and shows the pill;
  the reload just works without cache surgery.

## Files to change

| File | Change |
|---|---|
| `src/server/atlas-static.ts` (new) | `/api/atlas/:sha/:name` handler: sha guard (model A), name allowlist, gz negotiation, `immutable` headers |
| `src/server/index.ts` | dispatch `/api/atlas/` in the fetch fallback; inject `window.__ATLAS_SHA__` into the served `index.html` |
| `index.html` | add `window.__ATLAS_SHA__` placeholder; fix/drop the flat prefetch/preload hints |
| `src/lib/dataSource.tsx` | `DEFAULT_SOURCE.base` = sha-keyed when `window.__ATLAS_SHA__` set, else `BASE_URL` |
| `src/vite-env.d.ts` | declare `window.__ATLAS_SHA__` |
| `vite.config.ts` | SW runtimeCaching: sha-keyed atlas → `CacheFirst`/immutable; drop `atlas-data-large` SWR |
| `src/components/Footer.tsx` | `reloadWithFreshAtlas()` → plain reload (no cache-delete) |

## Sequencing vs the split

1. Land this prerequisite. Live artifacts now serve at `/api/atlas/<sha>/…`,
   immutable, with sha injected into HTML.
2. Then the docs-split (`docs-split.md`) adds `docs-meta.json` +
   `docs-content.json` to the artifact allowlist; they serve at
   `/api/atlas/<sha>/docs-meta.json` automatically. The atlas-worker single-owner
   loading design is unaffected — it fetches `${base}docs-meta.json` where `base`
   is now sha-keyed.

## Not in scope

- Model B (multi-generation retention on disk) — deferred.
- SHA-keying `chain-state.json` / `addresses.json` — these are not atlas-derived.
- Any change to the preview path — it is already sha-keyed and stays as-is.
