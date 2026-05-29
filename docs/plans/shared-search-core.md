# Shared Search Core — design

Status: **proposed** (a first server-side step is done; the cross-cutting refactor is not).
Origin: code-review reuse findings + the observation that the frontend reader and the
Railway MCP server each implement overlapping search logic.

## Principle

The win is a **shared pure search-core library** of environment-neutral functions that both
surfaces compose — NOT a runtime "service" called over the wire, and NOT one class with
`if (browser)` branches. Being explicit about what is genuinely common vs what must stay
environment-specific is what keeps the abstraction from leaking.

## What's common → `src/lib/search/` (pure, env-neutral, no DOM / no `import.meta`)

- **Tokenization contract** — the MiniSearch options + `processTerm`. This is the one with a
  real correctness coupling: the index *builder* and the *querier* must agree or results
  diverge. Currently **4 copies** (`build-index.mjs`, `search.worker.ts`, `search.test.ts`,
  `server/indexes.ts`).
- **Query parsing** — `extractPhrases` (`"double"` = case-insensitive phrase, `'single'` =
  case-sensitive), the `~N` fuzzy operator, term normalization. The *generic* part only.
- **Snippet** — with a `highlight` strategy arg: `<mark>` markup for the React reader, plain
  text for MCP/LLM consumers. (See open question below.)
- **RRF merge** (+ `RRF_K`) and the **exact-phrase post-filter**.

## What stays environment-specific → thin adapters (NOT in the core)

- **Index source** — reader loads the prebuilt `public/search-index.json`; the server builds
  fresh from `docs.json`. A shared `buildIndex(docs)` can be common; *where docs come from*
  isn't.
- **Semantic leg** — server-only (pgvector + OpenRouter). The browser has none. "hybrid" lives
  server-side; the core exposes lexical + RRF, the server adds the semantic adapter.
- **App-specific query rewriting** — the reader worker does `chainlog→address`, ticker
  handling, `in:`/`scope:` filters. That's reader-app logic, not generic search; it stays in
  the worker on top of the shared parse.
- **Transport** — worker `postMessage` vs MCP tool vs `/api/chat`.

## Proposed layout

```
src/lib/search/
  options.ts   # MiniSearch options + processTerm (the tokenization contract)
  parse.ts     # extractPhrases, fuzzy ~N, term normalization (generic only)
  snippet.ts   # buildSnippet(content, parsed, { highlight: "mark" | "none" })
  rrf.ts       # rrfMerge, RRF_K
  phrase.ts    # matchesPhrases(title, content, phrases, casePhrases)
```
Consumed by `src/workers/search.worker.ts` (+ reader-specific rewriting) and
`src/server/{search,indexes,query}.ts` (+ semantic adapter). Each wraps the core with its own
index source / transport.

## Two honest seams

1. **`build-index.mjs` runs under `node`** in `pnpm build` (and `bun` in `build:railway`), and
   node can't import a `.ts` const. So either the shared `options` module is plain `.js`/`.mjs`
   (typed via JSDoc) consumed by all, or `build-index` standardizes on bun. Until resolved,
   `build-index` keeps its copy with a `// canonical: src/lib/search/options.ts` pointer. This
   is the single place full unification has friction.
2. **This crosses into frontend code** (rewiring `search.worker.ts`), which the Railway phase
   scoped out. So the worker migration is a separate, reviewed change — verify behavior with the
   existing `src/workers/search.test.ts`.

## Open question

`buildSnippet` markup: the reader wants `<mark>` highlighting; an MCP/LLM consumer wants plain
text. Resolve by giving the shared snippet a `highlight` strategy arg (reader → `mark`, server →
`none`) rather than two implementations. Until then the server keeps a plain snippet and the
reader keeps `src/lib/searchHighlight.ts`.

## Migration path

1. **Done (server-side, in-scope, no FE change):** server now imports `UUID_RE` from
   `src/lib/patterns.ts` and `extractPhrases` from `src/lib/searchHighlight.ts`, and a shared
   `matchesPhrases` in `src/server/search.ts` backs both `atlas_search` and `atlas_query`
   (this also gained case-sensitive `'single-quote'` phrases). First step toward the core.
2. Create `src/lib/search/` (options/parse/snippet+highlight/rrf/phrase); migrate the server
   onto it.
3. Migrate the reader worker onto the same core; keep reader-specific rewriting on top.
4. Point `build-index` at the shared `options` (or move it to bun); drop the `// KEEP IN SYNC`
   copies. Verify with `search.test.ts` + a frontend search smoke.
