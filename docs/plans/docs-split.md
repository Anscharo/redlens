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

Both files are fetched in parallel at startup. `docs-meta.json` wins the race:

1. `docs-meta.json` arrives → atlas worker builds `byParent` / `docNoToId` →
   sends tree to UI → **sidebar renders**
2. `docs-content.json` arrives shortly after → merged into node map
3. By the time the user clicks a node, content is ready with no spinner needed

The data layer (`loadAtlas()` / `src/lib/docs.ts`) fires both fetches together
and exposes the merged result. Components above it see no interface change —
they still receive full `AtlasNode` objects. The only visible difference is that
the tree appears sooner.

If content hasn't arrived when a node is opened (edge case on very slow
connections), `NodeContent.tsx` can show a brief skeleton — but this should
be rare enough to be treated as a fallback, not the common path.

## Worker changes

**`atlas.worker.ts`**: fetch `docs-meta.json` instead of `docs.json`. The
worker only needs metadata to build the tree; it never uses `content`.

**`search.worker.ts`**: fetch both files. The search index (`search-index.json`)
is pre-built; the worker uses docs for snippet generation (needs content) and
result metadata (needs meta). Load both in parallel; index queries can begin as
soon as the search index loads regardless.

**`graph.worker.ts`**: no change — loads `relations.json`, not `docs.json`.

## Preview compatibility

No preview-specific changes needed. `build-index.mjs` already runs inside the
preview build pipeline (`build.ts` spawns it with isolated env vars). It will
naturally output both new files to the preview `out/` directory.

`ARTIFACT_ALLOWLIST` in `cache.ts`:
- Add `docs-meta.json` and `docs-content.json`
- Remove `docs.json` (no longer a browser artifact)

## Interaction with SHA-keyed serving (future)

This split works cleanly with SHA-keyed artifact URLs. Both new files get
`Cache-Control: immutable` cache headers. `window.__ATLAS_SHA__` injected into
HTML gives the browser the URL without an extra round-trip:

```
/api/atlas/<sha>/docs-meta.json   Cache-Control: immutable, max-age=2592000
/api/atlas/<sha>/docs-content.json  Cache-Control: immutable, max-age=2592000
```

## Files to change

| File | Change |
|---|---|
| `scripts/required/build-index.mjs` | emit `docs-meta.json` + `docs-content.json` alongside `docs.json` |
| `scripts/required/build-manifest.mjs` | include new files, exclude `docs.json` from browser set |
| `src/workers/atlas.worker.ts` | fetch `docs-meta.json` |
| `src/workers/search.worker.ts` | fetch `docs-content.json` (meta already in search index) |
| `src/lib/docs.ts` | `loadAtlas()` fetches both, merges before exposing |
| `src/server/preview/cache.ts` | update `ARTIFACT_ALLOWLIST` |
| `src/lib/staleDates.ts`, `activeDataIndex.ts`, etc. | no change (use merged result from `loadAtlas()`) |

## Not in scope

- Per-node lazy content fetching (adds API complexity, not needed)
- Streaming / NDJSON (superseded by this plan)
- Service worker / offline support
