# Shared Search Core — design

Status: **proposed** (tokenization is shared; query parsing, snippets, and ranking
are not). Origin: code-review reuse findings + the observation that the frontend
reader and the Railway MCP/chat server each implement overlapping search logic.

## Principle

The win is a **shared pure search-core library** of environment-neutral functions that both
surfaces compose — NOT a runtime "service" called over the wire, and NOT one class with
`if (browser)` branches. Being explicit about what is genuinely common vs what must stay
environment-specific is what keeps the abstraction from leaking.

## What's already shared (do not re-do)

- **Tokenization contract** — `src/lib/searchOptions.ts` (`MINISEARCH_OPTIONS` + `processTerm`).
  The reader worker and the Bun server both `MiniSearch.loadJSON` the prebuilt
  `search-index.json` with this object. `scripts/required/build-index.mjs` keeps an inline
  copy (it runs under node and cannot import the `.ts`); `scripts_tests/search-options-parity.test.ts`
  fails if they drift.
- **`extractPhrases`** — `src/lib/searchHighlight.ts`, re-exported from
  `src/server/retrieval/search.ts`. `"double"` = case-insensitive literal substring;
  `'single'` = case-sensitive.
- **Index artifact** — both surfaces deserialize `search-index.json`. The server
  `addAll`s from docs only as a fallback (tests / missing artifact).

## What's common → `src/lib/search/` (still to extract)

- **Query parsing** — `extractPhrases`, the `~N` fuzzy operator, term normalization.
  The *generic* part only.
- **Snippet** — with a `highlight` strategy arg: `<mark>` markup for the React reader, plain
  text for MCP/LLM consumers. (See open question below.)
- **RRF merge** (`RRF_K = 60`) — server-only today (`src/server/retrieval/search.ts`).
- **Phrase post-filter** — `matchesPhrases(title, content, phrases, casePhrases)`. Lives in
  `src/server/retrieval/search.ts`; the reader worker inlines the same substring test.

## What stays environment-specific → thin adapters (NOT in the core)

- **Index source** — a shared `buildIndex(docs)` can stay common for tests / fallback;
  *where the JSON comes from* (Vite `public/`, `config.publicDir`, `/api/atlas/<sha>/`) isn't.
- **Semantic leg** — server-only (pgvector + OpenRouter). The browser has none. "hybrid"
  lives server-side; the core exposes lexical + RRF, the server adds the semantic adapter.
- **App-specific query rewriting** — the reader worker does `chainlog→address`, ticker
  handling, `in:` / `type:` / `title:` / `content:` / `doc_no:` filters, UUID / doc-no
  fast-paths. There is **no** `scope:` operator (`in:` is the subtree filter). That stays
  in `apps/web/src/workers/search.worker.ts` on top of the shared parse.
- **Transport** — worker `postMessage` vs MCP tool vs `/api/chat`.

## Proposed layout

```
src/lib/search/
  options.ts   # MiniSearch options + processTerm (already at src/lib/searchOptions.ts)
  parse.ts     # extractPhrases, fuzzy ~N, term normalization (generic only)
  snippet.ts   # buildSnippet(content, parsed, { highlight: "mark" | "none" })
  rrf.ts       # rrfMerge, RRF_K
  phrase.ts    # matchesPhrases(title, content, phrases, casePhrases)
```

Consumed by `apps/web/src/workers/search.worker.ts` (+ reader-specific rewriting) and
`src/server/retrieval/{search,indexes,query}.ts` (+ semantic adapter). Each wraps the
core with its own index source / transport.

## Two honest seams

1. **`build-index.mjs` runs under `node`** in `pnpm build`, and node can't import a `.ts`
   const. So either the shared `options` module is plain `.js`/`.mjs` (typed via JSDoc)
   consumed by all, or `build-index` standardizes on bun. Until resolved, `build-index`
   keeps its copy; the parity test is the contract. This is the single place full
   unification has friction.
2. **Worker migration is a separate FE change** — verify with
   `apps/web/src/workers/search.worker.test.ts` (message protocol) and
   `apps/web/src/workers/search.test.ts` (live index).

## Open question

`buildSnippet` markup: the reader wants `<mark>` highlighting; an MCP/LLM consumer wants plain
text. Resolve by giving the shared snippet a `highlight` strategy arg (reader → `mark`, server →
`none`) rather than two implementations. Until then the server keeps a plain snippet and the
reader keeps `src/lib/searchHighlight.ts`.

## Migration path

1. **Done:** `src/lib/searchOptions.ts` is the tokenization contract; both queriers
   `loadJSON` the same artifact; `extractPhrases` is shared; `matchesPhrases` backs
   `atlas_search` / `atlas_query`.
2. Create `src/lib/search/` (parse/snippet+highlight/rrf/phrase); migrate the server onto it.
   Fold `searchOptions.ts` in (or re-export) so there is one directory.
3. Migrate the reader worker onto the same core; keep reader-specific rewriting on top.
4. Point `build-index` at the shared `options` (or move it to bun); drop the inline copy.
   Verify with `search.test.ts` + `e2e/search.spec.ts`.
