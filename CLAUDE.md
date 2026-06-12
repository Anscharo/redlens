# RedLens' Sky Atlas

A search-first interface for the Sky ecosystem's [next-gen-atlas](https://github.com/sky-ecosystem/next-gen-atlas). The atlas is included as a git submodule at `vendor/next-gen-atlas/`; source documents live at `vendor/next-gen-atlas/content/**` (one `document.md` per node, atomized since PR #236). When the atlas gets a new commit, trigger the **Atlas Update** GitHub Actions workflow (`.github/workflows/atlas-update.yml`) — it pulls the submodule, rebuilds all artifacts, and opens a PR.

**Atlas Markdown syntax reference**: `vendor/next-gen-atlas/ATLAS_MARKDOWN_SYNTAX.md` — canonical spec for heading format, document numbering, document types, extra fields, and nesting rules. Read this before touching the parser.

## Stack

- **Build/dev**: Vite + pnpm + TypeScript
- **UI**: React 19 + Tailwind v4 (via `@tailwindcss/vite`)
- **Search**: MiniSearch (full-content index, runs in a Web Worker)
- **Markdown**: react-markdown + remark-gfm + remark-math + rehype-katex (KaTeX)
- **Custom rehype plugin**: linkifies on-chain addresses to block explorers
- **Graph**: graphology (in a Web Worker) for node relations

## Commands

```bash
pnpm build:index     # parses content/** → public/docs.json + public/search-index.json + public/addresses.atlas.json (chain only; annotation added by build-graph)
pnpm build:glossary  # extracts Definitions sections → public/glossary.json
pnpm build:addresses # chainlog + Etherscan enrichment → public/addresses.json (on-chain fields only)
pnpm build:snapshot  # viem multicall snapshots → public/chain-state.json
pnpm build:graph     # Phase 2.6 annotates addresses; relation extraction → public/graph.json + public/relations.json; Phase 4.5 enriches public/addresses.atlas.json
pnpm build:history   # git log of atlas submodule → public/history/<uuid>.json
pnpm build:manifest  # sha256 digest of all artifacts → public/manifest.json
pnpm build:at        # reproducible build at a specific atlas commit
pnpm pull-atlas      # git submodule update --init --recursive (populate submodule after a shallow clone)
pnpm build:rag       # Workers AI bge-base-en embeddings → .cache/atlas-vectors/{vectors,ids,meta} (hosted MCP server only; NOT in pnpm build)
pnpm dev             # vite dev server
pnpm preview         # serve the production build locally
pnpm build           # frontend pipeline: index → glossary → addresses → snapshot → graph → manifest → tsc → vite
pnpm build:server    # hosted MCP server pipeline: index + graph + rag (run before sync-db sync scripts)
REPRO=1 pnpm test    # reproducibility check — two builds at the same atlas SHA must be byte-identical
pnpm test:snap       # graph snapshot tests — fail if relations.json structure changed (graph-snapshots/)
pnpm test:snap:update  # update graph snapshots after a deliberate atlas PR or build-graph change
```

### Process inventory scripts

The curated process inventory (`public/processes.json` + `public/processes-ignored.json`) is reconciled against atlas drift via a separate set of scripts. They split cleanly into human entry-points and machine entry-points.

**For humans to run:**

- **`pnpm processes:triage [--dry-run] [--issue N]`** — the canonical human entry point. Wrapper around `scripts/aux/processes-triage.sh`: clean-tree preflight → sync `main` → new branch `processes-triage/YYYY-MM-DD` → launch interactive Claude with the `processes-triage` skill (git/gh write tools blocked) → on exit, commit only `public/processes*.json`, push, open PR. `--dry-run` skips git ops + allows running from any branch. `--issue N` appends `Closes #N` to the PR body (issue body/comments are deliberately not read — the skill regenerates the authoritative audit locally).
- **`pnpm processes:apply-decisions <decisions.json>`** — apply a `[{ uuid, verdict: "add"|"ignore", ... }]` decisions file to the inventory. Consumed by the `processes-triage` skill (large-batch path) and by the curation UI on `/reports/processes` (which exports this exact shape).

**For workflows / CI to call (humans rarely run directly):**

- **`pnpm processes:check`** — runs `scripts/required/check-processes-dirty.mjs`: auto-applies title/doc_no snapshot drift in place, writes `.cache/processes-audit.{json,md}`, emits GH Actions outputs (`dirty`, `missing`, `candidates`). **Always exits 0** so it never blocks builds or deployments. Called from `.github/workflows/atlas-update.yml`. Humans only run it manually to refresh the audit cache before triage.

**One-shot / rarely needed:**

- **`pnpm processes:bootstrap`** — rebuild `public/processes.json` from scratch using `docs/process-inventory.md`. Only used for the initial seed; not part of the steady-state cycle.

## Architecture

### Data pipeline

Each build pass is its own script. They run in order in `pnpm build`:

Scripts are split: `scripts/required/` holds the build pipeline entry-points wired into `pnpm build:*`; `scripts/lib/` holds shared modules (parsing, regexes, extraction phases) imported by those entry-points; `scripts/aux/` holds offline / one-off / experimental scripts (`build-rag`, `query-rag`, `tva.sh`, etc.) that are not part of the core build chain.

- **`scripts/required/build-index.mjs`** — parses `Sky Atlas.md`, emits `public/docs.json` (`Record<uuid, AtlasNode>`), `public/search-index.json` (serialized MiniSearch index), and a minimal `public/addresses.atlas.json` (`{ addr: { chain } }`). Annotation (roles, labels, tokens) is deferred to `build-graph` Phase 2.6. Imports `lib/atlas-parser.mjs`, `lib/address-chains.mjs`.
- **`scripts/required/build-glossary.mjs`** — finds all `Definitions` sections, collects direct `[Core]` children as terms, emits `public/glossary.json` keyed by lowercased term.
- **`scripts/required/build-addresses.mjs`** — fetches Sky chainlog, calls Etherscan `getsourcecode` per unique address (read-through disk cache at `.cache/etherscan/<chainid>/<addr>.json`), emits `public/addresses.json` (on-chain fields only: `chain`, `chainlogId`, `etherscanName`, `isContract`, `isProxy`, `implementation`). Does **not** delete `public/addresses.atlas.json`. Imports `lib/address-enrich.mjs`.

**Address artifact split:**
- `public/addresses.atlas.json` — atlas-derived: `chain`, `explorerUrl`, `roles`, `entityLabel`, `aliases`, `expectedTokens`. Written by `build-index`, enriched by `build-graph` Phase 4.5. Permanent artifact.
- `public/addresses.json` — on-chain: `chain`, `chainlogId?`, `etherscanName?`, `isContract`, `isProxy`, `implementation?`. Written by `build-addresses`. Never contains atlas annotation fields.
- Frontend `loadAddresses()` loads both in parallel, merges per-address, resolves `label = chainlogId ?? entityLabel ?? etherscanName`.

- **`scripts/required/build-graph.mjs`** — pattern-driven relation extraction. **Phase 2.6** (before entity extraction) scans all doc content for addresses and applies structural role/label/token annotation — this replaces what was previously in `build-index`. **Phase 2.5** scans Instance entities for address-valued ICD params and emits `has_address` edges. **Phase 4.5** (five passes) enriches `public/addresses.atlas.json` with ICD-derived roles and labels, entity-linked labels, doc-title labels, and chainlog fallback. Emits `public/graph.json` and `public/relations.json`. No loopback to build-index. See `.claude/skills/parse-atlas/SKILL.md`. Imports `lib/graph-patterns.mjs`, `lib/graph-instances.mjs`, `lib/graph-entities.mjs` (Phase 1), `lib/graph-doc-edges.mjs` (Phase 2 doc edges 2a–2h), `lib/graph-entity-edges.mjs` (Phase 2 entity/address edges 2i–2w), `lib/address-chains.mjs`, `lib/address-annotate.mjs`.
- **`scripts/required/build-history.mjs`** — walks git log of the atlas submodule, emits `public/history/<uuid>.json` per node. Imports `lib/atlas-parser.mjs` for `HEADING_RE`.
- **`scripts/required/build-manifest.mjs`** — sha256 digest of every shipping artifact.
- **`scripts/required/build-at.mjs`** — reproducible build at a pinned atlas commit; orchestrates the other `build:*` scripts.

Heading regex (each node):

```
^(#{1,6}) ([\w.-]+) - (.+?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->$
```

Each node has: `id` (uuid), `doc_no` (e.g. `A.0.1.1`), `title`, `type`, `depth` (heading level 1–6, **capped at 6** — semantic depth from the doc number may exceed 6), `parentId`, `order`, `content`, `addressRefs`. Parent IDs are resolved via a depth-indexed ancestor stack.

**Atlas document types** (from the syntax spec): Scope, Article, Section, Core, Type Specification, Active Data Controller, Annotation, Action Tenet, Scenario, Scenario Variation, Active Data, Needed Research. Supporting documents (Annotations, Action Tenets, Scenarios, Scenario Variations, Active Data) use special directory-number patterns (`.0.3.X`, `.0.4.X`, `.1.X`, `.varX`, `.0.6.X`). Needed Research uses global `NR-X` numbering.

`cleanContent()` strips wrapping single-backtick markers from multi-line backtick blocks (an Atlas authoring quirk) — but does NOT remove code/backtick _content_.

### On-chain address extraction

See `.claude/skills/address-extraction/SKILL.md` for the full reference: EVM/Solana regex patterns, the load-bearing hex-boundary lookarounds, chain detection algorithm, `ROLE_VOCAB` classification, and the sync constraint between `address-chains.mjs` and `NodeContent.tsx`.

### Frontend

`App.tsx` is the shell (routing, URL sync, layout). The main atlas view is `src/components/atlas/AtlasView.tsx`.

**Workers:**

- **`src/workers/search.worker.ts`** — loads `docs.json` + `search-index.json`, runs MiniSearch queries, generates highlighted snippets. Phrase post-filter: `"quoted"` phrases are stripped before the MiniSearch query, then every hit is checked for literal substring containment.
- **`src/workers/atlas.worker.ts`** — loads and parses `docs.json` for the atlas tree view.
- **`src/workers/graph.worker.ts`** — loads `relations.json` into a graphology `MultiDirectedGraph`; answers edge queries, BFS neighbor/subgraph requests for the main thread.

**Atlas view (`src/components/atlas/`):**

- **`AtlasView.tsx`** — main atlas page. Loads atlas + addresses + chain-state + glossary in parallel. Renders a flat virtualized list via `CollapsibleNode`. Computes `linkedNodes`, `targetAddresses`, `glossaryTerms` in a single `useMemo` keyed on `[data, id]`. Passes everything to `RightPanel`.
- **`CollapsibleNode.tsx`** — single row in the atlas tree. Expand/collapse, depth-based indent, renders node content via `NodeContent`. Nodes at depth ≥ 6 are hidden behind a "view all descendants" button until expanded.
- **`RightPanel.tsx`** — right annotations panel. Three tabs: `annotations` (linked docs, graph relations, addresses), `glossary` (terms found in this section), `history`. All data arrives as props from `AtlasView`. Tab state is URL-synced via `?view=glossary` / `?view=history`.

**Shared components (`src/components/`):**

- **`NodeContent.tsx`** / **`NodeContentInner.tsx`** — markdown rendering. `rehypeEthAddresses` plugin linkifies on-chain addresses; KaTeX loaded lazily on demand. `onNavigate` via React context. UUID hrefs intercepted for SPA navigation.
- **`RelatedNode.tsx`** — linked-node card in the right panel.
- **`AddressCard.tsx`** — address card with entity label, aliases, explorer link, role pills.
- **`SearchBar.tsx`** — header: home link, search input, scope filter pills.
- **`SearchResults.tsx`** / **`SearchResult.tsx`** — result list and individual result card.
- **`SearchHints.tsx`** — idle-state syntax cheat sheet.

**Hooks / lib:**

- **`src/hooks/useSearch.ts`** — debounced search hook with pending-id race guard.
- **`src/lib/docs.ts`** — `loadAtlas()` module-level Promise cache for `docs.json`.
- **`src/lib/addresses.ts`** — `loadAddresses()` module-level cache for `addresses.json`.
- **`src/lib/glossary.ts`** — `loadGlossary()` + `buildLookup()`. Lookup flattens parenthetical aliases (`"Accessibility Scope (ACC)"` → keys for both `"accessibility scope"` and `"acc"`).
- **`src/lib/graph.ts`** — `loadGraph()` (cached graph data for reports/radar), `getEdges(id)` — async wrapper that messages the graph worker for a node's edges.
- **`src/lib/atlasHelpers.ts`** — shared helpers (`extractLinkedIds`, `buildAncestors`) and the `LoadedData` interface.

**Radar (`src/components/radar/`):**

Entity-focused view at `/radar` (index) and `/radar/:slug` (actor page). Builds actor profiles from the graph — chain (prime → executor → facilitator/govops), active data responsibilities, reward instances, primitive instances with params, and governance relationships. Key files: `RadarPage.tsx` (routing + data loading), `ActorDashboard.tsx` (layout), `ActorInstances.tsx`, `ActorChain.tsx`, `ActorResponsibilities.tsx`. Data logic lives in `src/lib/actorIndex.ts` (`buildActorProfile`, `buildSidebarActors`).

**Reports (`src/components/reports/`):**

Three reports at `/reports/*`: Op Facilitator Responsibilities, Active Data Index, Integrator Reward Relationships. Data logic is separated into pure modules (`src/lib/facilitatorResponsibilities.ts`, `src/lib/activeDataIndex.ts`, `src/lib/rewardsIndex.ts`) so they're testable without React.

**Graph snapshots (`graph-snapshots/`):**

Vitest snapshot tests that record the current state of `relations.json`. Run `pnpm test:snap` to verify no drift; run `pnpm test:snap:update` to accept deliberate changes. Uses `vitest.snap.config.ts` (separate from the main `vitest.config.ts` which excludes this folder).

### Base path

`vite.config.ts` sets `base: '/redlens/'`. Any runtime string used as a URL (not an import Vite transforms) MUST be prefixed with `import.meta.env.BASE_URL`. This applies to `fetch(...)` in workers, icon `<img src>`, all `pushState`/`href` links, etc. Hardcoded `"/"` paths will 404 in dev.

### Styling

Color tokens live as CSS variables in `src/index.css`:

- `--bg #160e0d` (charcoal w/ red undertone), `--surface`, `--hover #3a1f1a`
- `--red #a63228`, `--accent #c67267` (links/focus, browner-pinker — _not_ the original error-looking red)
- `--tan #f3e7ce` / `--tan-2` / `--tan-3` (tans/browns)
- Fonts: Lora (serif body), Source Code Pro (mono)
- KaTeX is overridden to use `--tan` color

Selected-node treatment: red left bar, transparent background, brighter text. Don't add backgrounds to the selected node.

## Conventions / preferences

- **Use semantic HTML elements**: `h1`–`h6` for headings, `<button>` for actions, `<a>` for navigation, `<article>`/`<section>`/`<header>` for sectioned content. Prefer native elements over `<div>`/`<span>` with ARIA roles when a semantic element fits.
- **Don't add hover/click logic in JS when CSS will do it.**
- **The home button is a plain HTML link** (`<a href="/">`), not an `onClick` handler.
- **Search quality > bundle size** for the MiniSearch index. Full-content indexing is intentional.
- **Scroll-to is `behavior: "instant"`**, not smooth — the user found smooth scrolling sluggish.
- **Sticky header collisions**: any scroll target needs `scrollMarginTop: "64px"`.
- **Don't override git user.name/email.** Trust global config.
- **Show stats before touching the UI** when changing the build pipeline. The user wants to see counts/samples before any visual change consumes new data.
- **Each build pass gets its own script** (`scripts/required/build-<thing>.mjs`) and its own `pnpm build:<thing>`. Don't add new passes to `build-index.mjs`. Shared logic belongs in `scripts/lib/`.
- **Max 3 components per file** (only if 2 are <8 lines); max ~150 lines per file.
- **Node stdlib imports use `node:` prefix**: `import fs from "node:fs"`, `import path from "node:path"`, etc. Never bare `"fs"` or `"path"`.
- **Prefer MCP atlas tools over grep** for atlas content exploration: `atlas_get`, `atlas_search`, `atlas_neighbors`. Use grep only for exact known strings (UUIDs, addresses, regex patterns).
- **Never hardcode doc_nos as identifiers.** Doc numbers (e.g. `A.2.2.8.1`) are editorial labels that change whenever the atlas is renumbered — PR #235 proved this. UUIDs are the stable identity. Rules:
  - To look up a specific document: use its UUID as the key into `docs[uuid]` or `byParent.get(uuid)`.
  - To record a doc_no in source for human reference: put it in a comment next to the UUID (`// A.1.6`), never as the lookup key.
  - Doc_no **prefix matching** (`.startsWith("A.6.1.1.")`) for scope membership is also fragile: if the scope's own doc_no changes, every descendant prefix breaks. Prefer UUID-based ancestor checking via `parent_of` edges when refactoring those paths. Existing prefix matches are annotated with `// fragile: doc_no prefix` until migrated.
  - **Exception — spec-defined structural suffix patterns**: `ATLAS_MARKDOWN_SYNTAX.md` explicitly defines these suffixes as invariant parts of the format: `.0.3.X` (Annotation), `.0.4.X` (Action Tenet), `.1.X` (Scenario), `.varX` (Scenario Variation), `.0.6.X` (Active Data), `NR-X` (Needed Research). Regex and `startsWith`/`endsWith` checks against these structural suffixes are stable and correct — the spec guarantees them, they are not editorial doc_nos.

## Pending work

### Deferred: chunk long nodes for semantic search

`scripts/required/build-rag.mjs` produces one bge-base-en (768d) vector per atlas node, with a 2048-char cap that bge-base's 512-token positional limit forces anyway. ~25 nodes (0.24%) exceed the cap — registries (e.g. `Current Aligned Delegates`), Type Specifications, Reference Implementations, and a few long Cores. Their heads carry the semantic intent, but the tails (enumerated names, code, field lists) become invisible to semantic search.

Lexical (FTS5) and the hybrid `atlas_search` mode already reach this tail content, so this is recall optimization on the *semantic* leg only — not a correctness gap.

If/when this matters:
- Chunk nodes with `content.length > 2048` into ~1500-char overlapping windows; emit one vector per chunk with a synthetic id (`<uuid>#<chunk-idx>`).
- Vectorize metadata stays per-node (`docId`, `doc_no`, `type`, `depth`); the worker dedupes back to one row per `docId` before RRF merge.
- Adds ~70 vectors total — still inside the Vectorize free tier.
- Build cost is one extra Workers AI call per long node; trivial.


### Other / background
