# docs-meta / docs-content split

Replace the single `docs.json` browser artifact with two smaller files so the
atlas tree can render before the full content payload arrives.

## Problem

`docs.json` is a single ~5 MB file (~1 MB compressed) containing metadata AND
full markdown content for every node. The atlas tree only needs metadata to
render. Content is needed only when a node is opened. Loading both together
delays first paint unnecessarily.

## File split

### `docs-meta.json`
All nodes, metadata only. Shape is identical to today's `docs.json` minus
`content`:

```json
{
  "atlasCommit": "abc123",
  "nodes": {
    "<uuid>": {
      "id": "<uuid>",
      "doc_no": "A.1.2",
      "title": "...",
      "type": "Section",
      "depth": 3,
      "parentId": "<uuid>",
      "order": 5,
      "contentHash": "...",
      "addressRefs": [...]
    }
  }
}
```

Estimated size: ~10% of current `docs.json` (~100 KB compressed).

### `docs-content.json`
Flat KV map, id → content string only:

```json
{
  "<uuid>": "full markdown content…",
  "<uuid>": "..."
}
```

Estimated size: ~90% of current `docs.json` (~900 KB compressed).

## What stays on `docs.json`

`docs.json` is kept as an **internal build/server artifact** — never served to
the browser. Consumers that need it unchanged:

- `build-graph.mjs` — reads docs to extract relations (needs content)
- Server `indexes.ts` / `atlas-refresh.ts` — in-memory node map, diff,
  embeddings (needs full nodes)
- `sync-embeddings.ts`, history, MCP — all server-side

No changes to any server-side code.

## Build pipeline

`build-index.mjs` emits all three files from the same parse pass:

1. `docs.json` — unchanged (internal, not shipped to browser)
2. `docs-meta.json` — nodes without `content`
3. `docs-content.json` — `{ [id]: content }` KV

Single additional loop over the already-built node map; no re-parsing.

`build-manifest.mjs` gains `docs-meta.json` and `docs-content.json`; drops
`docs.json` from the browser artifact set (it's still built, just not manifested
as a served file).

## Browser loading sequence

**Single-owner rule: each file crosses the network exactly once.** This matches
the architecture already in place for `docs.json` — `atlas.worker` is the sole
fetcher, and every other consumer (the main thread, `search.worker`) gets the
data by `postMessage`, never by an independent fetch. The split preserves that
ownership model; it does not introduce parallel fetches in multiple consumers.

`atlas.worker` fetches **both** files and emits two messages:

1. `docs-meta.json` arrives → worker builds `byParent` / `docNoToId` → posts a
   **`tree`** message (meta + lookup maps, no content) → **sidebar renders**
2. `docs-content.json` arrives shortly after → merged into the node map → worker
   posts a **`ready`** message with the complete `AtlasNode` map
3. Main thread forwards the merged docs to `search.worker` via the existing
   `preload` message — the search worker fetches no docs of its own
4. By the time the user clicks a node, content is present with no spinner needed

The data layer (`loadAtlas()` / `src/lib/docs.ts`) does not fetch — it spawns
the atlas worker and resolves from the worker's messages, exactly as today. The
`AtlasBundle` contract grows a two-phase shape: the tree/lookup maps resolve on
the `tree` message (early), the full `content`-bearing node map resolves on the
`ready` message (slightly later). Components downstream of the merged result see
no interface change — they still receive full `AtlasNode` objects; only the tree
appears sooner.

We deliberately do **not** rely on the HTTP cache to dedupe fetches across
consumers: parallel in-flight requests for the same URL are not reliably
coalesced, so two consumers fetching `docs-content.json` "in parallel" can both
hit the network. Single-owner + `postMessage` fan-out is the only guarantee.

On very slow connections where content hasn't arrived yet, the existing node
content loading skeleton handles the wait — no new loading states needed.

## Worker changes

**`atlas.worker.ts`**: fetch `docs-meta.json` **and** `docs-content.json` (it is
the single owner of both). Build the tree from meta and post it immediately
(`tree` message) so the sidebar can render before content lands; then merge
content into the node map and post the complete docs (`ready` message).

**`search.worker.ts`**: **no fetch change** — it continues to receive docs via
the `preload` message from the main thread (which got them from the atlas
worker). It only fetches its own pre-built `search-index.json`, as today. The
worker uses the preloaded docs for snippet generation (content) and result
metadata; index queries can begin as soon as `search-index.json` loads,
regardless of when the preload arrives.

**`graph.worker.ts`**: no change — loads `relations.json`, not `docs.json`.

## Preview compatibility

No preview-specific changes needed. `build-index.mjs` already runs inside the
preview build pipeline (`build.ts` spawns it with isolated env vars). It will
naturally output both new files to the preview `out/` directory.

`ARTIFACT_ALLOWLIST` in `cache.ts`:
- Add `docs-meta.json` and `docs-content.json`
- Remove `docs.json` (no longer a browser artifact)

## Prerequisite: SHA-keyed serving

This split lands **after** `sha-keyed-serving.md`, which moves live atlas
artifacts from flat `BASE_URL` paths to immutable, SHA-keyed URLs
(`/api/atlas/<sha>/<name>.json`). Once that prerequisite is in:

- The two new files are added to the artifact allowlist and serve at
  `/api/atlas/<sha>/docs-meta.json` and `/api/atlas/<sha>/docs-content.json`
  automatically, with `Cache-Control: immutable`.
- Consumers fetch `${base}docs-meta.json` where `base` is already sha-keyed
  (`window.__ATLAS_SHA__` injected into the HTML) — the single-owner atlas-worker
  loading design above is unaffected by the URL scheme.

If for any reason the split lands first, both files simply serve flat under
`BASE_URL` like `docs.json` does today; the only change at SHA-keying time is the
allowlist entry.

## Files to change

| File | Change |
|---|---|
| `scripts/required/build-index.mjs` | emit `docs-meta.json` + `docs-content.json` alongside `docs.json` |
| `scripts/required/build-manifest.mjs` | include new files, exclude `docs.json` from browser set |
| `src/workers/atlas.worker.ts` | sole fetcher: fetch both `docs-meta.json` + `docs-content.json`; post `tree` (meta) then `ready` (merged) |
| `src/workers/search.worker.ts` | **no fetch change** — still preloaded from main thread; keeps fetching only `search-index.json` |
| `src/lib/docs.ts` | `loadAtlas()` resolves from the worker's two-phase messages (tree early, merged docs later); no fetch added |
| `src/server/preview/cache.ts` | update `ARTIFACT_ALLOWLIST` |
| `src/lib/staleDates.ts`, `activeDataIndex.ts`, etc. | no change (use merged result from `loadAtlas()`) |

## Not in scope

- Per-node lazy content fetching (adds API complexity, not needed)
- Streaming / NDJSON (superseded by this plan)
- Service worker / offline support
