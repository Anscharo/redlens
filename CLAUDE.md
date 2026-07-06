# RedLens' Sky Atlas

A search-first interface for the Sky ecosystem's [next-gen-atlas](https://github.com/sky-ecosystem/next-gen-atlas). The atlas is included as a git submodule at `vendor/next-gen-atlas/`; source documents live at `vendor/next-gen-atlas/content/**` (one `document.md` per node, atomized since PR #236). Atlas-derived artifacts (`docs.json`, `graph.json`, `relations.json`, `search-index.json`, `glossary.json`, `addresses.atlas.json`, `manifest.json`, `history/`) are **not committed to git** — they are built ephemerally at container startup (by the Dockerfile) or synced into Postgres (doc content + history + embeddings, by the Railway atlas worker service). The in-process updater polls `sync_state.atlas_sha` and rebuilds in-memory indexes from DB rows on drift — no git access needed at runtime.

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
pnpm snap:chainstate  # viem multicall snapshots → public/chain-state.json
pnpm build:graph     # Phase 2.6 annotates addresses; relation extraction → public/graph.json + public/relations.json; Phase 4.5 enriches public/addresses.atlas.json
pnpm build:history   # git log of atlas submodule → upsert atlas_history in Postgres (DB sink, reads its own incremental cursor); add --out-json to write public/history/<uuid>.json instead (DB-less, used by canary tests); --full forces a full walk
pnpm build:manifest  # sha256 digest of all artifacts → public/manifest.json
pnpm build:at        # reproducible build at a specific atlas commit
pnpm pull-atlas      # git submodule update --init --recursive (populate submodule after a shallow clone)
pnpm atlas:worker    # full atlas worker cycle: drift check → build → sync all Postgres tables
pnpm dev             # vite dev server (requires artifacts built first — see Local dev below)
pnpm preview         # serve the production build locally
pnpm build           # frontend pipeline: index → glossary → addresses → snapshot → graph → manifest → tsc → vite
REPRO=1 pnpm test    # reproducibility check — two builds at the same atlas SHA must be byte-identical
pnpm test:snap       # graph snapshot tests — fail if relations.json structure changed (graph-snapshots/)
pnpm test:snap:update  # update graph snapshots after a deliberate atlas PR or build-graph change
pnpm census:check    # coverage census: warn ([drift]) when uncovered structure clusters appear/grow vs .github/atlas-census-baseline.json; --update rewrites the baseline (atlas-update.yml does this per bump). Always exits 0.
```

### Local dev

```bash
pnpm dev
```

`pnpm dev` is one-command: a preflight (`scripts/aux/dev-preflight.mjs`) runs, in order: `pnpm install` (only when `pnpm-lock.yaml`'s content hash changed — stamped in `node_modules/.dev-deps-hash`, so the steady state pays no install); ensures the Docker daemon is up (launches Docker Desktop on macOS, instructs on Linux); brings the Postgres container up + healthy (`docker compose`); runs the atlas worker in `--no-fetch` mode to sync Postgres to the **checked-out** atlas commit (build index+graph → `sync.ts` → history; embeddings only if an API key is set); and builds the atlas artifacts (`docs.json`, `graph.json`, `relations.json`, `glossary.json`, `search-index.json`, `addresses.atlas.json` — none committed) if they're missing. Then it starts the Bun API server + Vite together.

Local dev builds the **checked-out** submodule commit, NOT `origin/main` — advancing to upstream is the cron worker's job (`pnpm atlas:worker`, no `--no-fetch`). Syncing the DB to the checked-out commit also stops the in-process updater from looping to drag live back to a stale local `sync_state.atlas_sha`.

Escape hatches: `DEV_NO_INSTALL=1` (skip the install check), `DEV_NO_WORKER=1` (DB up but skip the atlas sync; the server migrates at boot), `DEV_NO_DB=1` (skip Docker/Postgres entirely — reader works off disk artifacts; history/chat/preview need a DB), `DEV_NO_BUILD=1` (skip the artifact build). After a shallow clone run `pnpm pull-atlas` first to populate the submodule.

### Process inventory scripts

The curated process inventory (`public/processes.json` + `public/processes-ignored.json`) is reconciled against atlas drift via a separate set of scripts. They split cleanly into human entry-points and machine entry-points.

**For humans to run:**

- **`pnpm processes:triage [--dry-run] [--issue N]`** — the canonical human entry point. Wrapper around `scripts/aux/processes-triage.sh`: clean-tree preflight → sync `main` → new branch `processes-triage/YYYY-MM-DD` → launch interactive Claude with the `processes-triage` skill (git/gh write tools blocked) → on exit, commit only `public/processes*.json`, push, open PR. `--dry-run` skips git ops + allows running from any branch. `--issue N` appends `Closes #N` to the PR body (issue body/comments are deliberately not read — the skill regenerates the authoritative audit locally).
- **`pnpm processes:apply-decisions <decisions.json>`** — apply a `[{ uuid, verdict: "add"|"ignore", ... }]` decisions file to the inventory. Consumed by the `processes-triage` skill (large-batch path) and by the curation UI on `/reports/processes` (which exports this exact shape).

**For workflows / CI to call (humans rarely run directly):**

- **`pnpm processes:check`** — runs `scripts/required/check-processes-dirty.mjs`: auto-applies title/doc_no snapshot drift in place, writes `.cache/processes-audit.{json,md}`, emits GH Actions outputs (`dirty`, `missing`, `candidates`). **Always exits 0** so it never blocks builds or deployments. Humans run it manually to refresh the audit cache before triage.

**One-shot / rarely needed:**

- **`pnpm processes:bootstrap`** — rebuild `public/processes.json` from scratch using `docs/process-inventory.md`. Only used for the initial seed; not part of the steady-state cycle.

## Architecture

### Data pipeline

Each build pass is its own script. They run in order in `pnpm build`:

Scripts are split: `scripts/required/` holds the build pipeline entry-points wired into `pnpm build:*`; `scripts/lib/` holds shared modules (parsing, regexes, extraction phases) imported by those entry-points; `scripts/aux/` holds offline / one-off / experimental scripts (`tva.sh`, etc.) that are not part of the core build chain.

- **`scripts/required/build-index.mjs`** — parses `Sky Atlas.md`, emits `public/docs.json` (`Record<uuid, AtlasNode>`), `public/search-index.json` (serialized MiniSearch index), and a minimal `public/addresses.atlas.json` (`{ addr: { chain } }`). Annotation (roles, labels, tokens) is deferred to `build-graph` Phase 2.6. Imports `lib/atlas-parser.mjs`, `lib/address-chains.mjs`.
- **`scripts/required/build-glossary.mjs`** — finds all `Definitions` sections, collects direct `[Core]` children as terms, emits `public/glossary.json` keyed by lowercased term.
- **`scripts/required/build-addresses.mjs`** — fetches Sky chainlog, calls Etherscan `getsourcecode` per unique address (read-through disk cache at `.cache/etherscan/<chainid>/<addr>.json`), emits `public/addresses.json` (on-chain fields only: `chain`, `chainlogId`, `etherscanName`, `isContract`, `isProxy`, `implementation`). Does **not** delete `public/addresses.atlas.json`. Imports `lib/address-enrich.mjs`.

**Address artifact split:**
- `public/addresses.atlas.json` — atlas-derived: `chain`, `explorerUrl`, `roles`, `entityLabel`, `aliases`, `expectedTokens`. Written by `build-index`, enriched by `build-graph` Phase 4.5. Permanent artifact.
- `public/addresses.json` — on-chain: `chain`, `chainlogId?`, `etherscanName?`, `isContract`, `isProxy`, `implementation?`. Written by `build-addresses`. Never contains atlas annotation fields.
- Frontend `loadAddresses()` loads both in parallel, merges per-address, resolves `label = chainlogId ?? entityLabel ?? etherscanName`.

- **`scripts/required/build-graph.mjs`** — pattern-driven relation extraction. **Phase 2.6** (before entity extraction) scans all doc content for addresses and applies structural role/label/token annotation — this replaces what was previously in `build-index`. **Phase 2.5** scans Instance entities for address-valued ICD params and emits `has_address` edges. **Phase 4.5** (five passes) enriches `public/addresses.atlas.json` with ICD-derived roles and labels, entity-linked labels, doc-title labels, and chainlog fallback. Emits `public/graph.json` and `public/relations.json`. No loopback to build-index. See `.claude/skills/parse-atlas/SKILL.md`. Imports `lib/graph-patterns.mjs`, `lib/graph-instances.mjs`, `lib/graph-entities.mjs` (Phase 1), `lib/graph-doc-edges.mjs` (Phase 2 doc edges 2a–2h), `lib/graph-entity-edges.mjs` (Phase 2 entity/address edges 2i–2w), `lib/graph-multisigs.mjs`, `lib/graph-transfers.mjs`, `lib/graph-bridges.mjs`, `lib/graph-omni.mjs`, `lib/graph-transitions.mjs` (Phase 2.8 patterns 17/18/21/22/23), `lib/address-chains.mjs`, `lib/address-annotate.mjs`.
- **`scripts/required/build-history.mjs`** — walks git log of the atlas submodule and computes per-node change history with diffs. Two sinks: **default** upserts straight into Postgres `atlas_history` (reads its own incremental cursor via `MAX(commit_seq)`, runs under Bun); **`--out-json`** writes the legacy `public/history/<uuid>.json` files (DB-less, for the canary/artifact tests). Shared DB write path lives in `src/server/history-db.ts` (`eventToRow`, `upsertHistory`, `gitCommitSeq`, `readHistoryCursor`). Imports `lib/atlas-parser.mjs` for `HEADING_RE`.
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

Reports at `/reports/*`: Op Facilitator Responsibilities, Active Data Index, Integrator Reward Relationships, Atlas Processes, Stale Dates. Data logic is separated into pure modules (`src/lib/facilitatorResponsibilities.ts`, `src/lib/activeDataIndex.ts`, `src/lib/rewardsIndex.ts`, `src/lib/staleDates.ts`) so they're testable without React. Stale Dates recomputes client-side from `docs.json` + the actual date on every visit (no build step or worker involvement — it can't serve a stale view).

**Graph snapshots (`graph-snapshots/`):**

Vitest snapshot tests that record the current state of `relations.json`. Run `pnpm test:snap` to verify no drift; run `pnpm test:snap:update` to accept deliberate changes. Uses `vitest.snap.config.ts` (separate from the main `vitest.config.ts` which excludes this folder).

### Base path

`vite.config.ts` sets `base: '/'` — the app is served from the domain root on Railway. GitHub Pages is only a redirect stub (`gh-pages-redirect/`, the one place `/redlens/` survives), not a deployment target, so there is no non-root base variant anymore.

`import.meta.env.BASE_URL` is therefore always `"/"`. Existing references still work (they evaluate to `"/"`) and don't need stripping, but new code can use root-relative paths directly. Note the distinct **data-source base** abstraction (`src/lib/atlasBase.ts` `liveAtlasBase()`, `src/lib/dataSource.tsx`): atlas-versioned artifacts are served under `/api/atlas/<sha>/` (or a preview base) and fall back to `import.meta.env.BASE_URL` — that base parameter is unrelated to `/redlens/` and is load-bearing for sha-keyed/preview serving.

### Styling

Color tokens live as CSS variables in `src/index.css`:

- `--bg #160e0d` (charcoal w/ red undertone), `--surface`, `--hover #3a1f1a`
- `--red #a63228`, `--accent #c67267` (links/focus, browner-pinker — _not_ the original error-looking red)
- `--tan #f3e7ce` / `--tan-2` / `--tan-3` (tans/browns)
- Fonts: Inter (body), Source Code Pro (mono)
- KaTeX is overridden to use `--tan` color

Selected-node treatment: red left bar, brighter text, plus a subtle muted-red fill (`--bg`) that sits against the deeper reader/sidebar bg (`--bg-deep`). (Earlier guidance said "never add a background to the selected node" — that was reversed intentionally once the reader adopted the deep bg; the soft `--bg` tint is now the selected marker alongside the bar.)

## Conventions / preferences

- **Use semantic HTML elements**: `h1`–`h6` for headings, `<button>` for actions, `<a>` for navigation, `<article>`/`<section>`/`<header>` for sectioned content. Prefer native elements over `<div>`/`<span>` with ARIA roles when a semantic element fits.
- **Don't add hover/click logic in JS when CSS will do it.**
- **The home button is a plain HTML link** (`<a href="/">`), not an `onClick` handler.
- **Search quality > bundle size** for the MiniSearch index. Full-content indexing is intentional.
- **Scroll-to is a fast fixed-duration glide** (`src/lib/animatedScroll.ts`): 220ms ease-out over the full distance, so duration never grows with distance. Never use native `behavior: "smooth"` — the user found it sluggish. Reduced-motion falls back to instant.
- **Sticky header collisions**: any scroll target needs `scrollMarginTop: "64px"`.
- **Don't override git user.name/email.** Trust global config.
- **Show stats before touching the UI** when changing the build pipeline. The user wants to see counts/samples before any visual change consumes new data.
- **Keep `patch-notes.md` (repo root) current.** It backs the homepage "Recent improvements" log. When a change ships a user-visible feature or fix, add a one-line bullet in the same PR. Date each `## YYYY-MM-DD` group by **the day the change becomes public** — the day it deploys/merges to main, or the day its feature flag is turned on — **not** the day the PR opens; newest date first. Write each bullet **for the end user**: past-tense verb + object, plain language describing something a user would find interesting (e.g. "Added a Stale Dates report", "Lightened colors for better visibility") — never dev/PM framing. Format is enforced by `pnpm check:patch-notes` (pre-commit hook + CI), which requires strict newest-first dates.
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

### Deferred: audit follow-ups (2026-06 frontend/dataflow audit)

Remaining items from the full-branch audit (the bug fixes landed in the same PR as this note):

- **Split oversized component files** — 18 component files exceed the ~150-line convention. Top offenders: `OpFacilitatorsReport.tsx` (395), `ProcessesReport.tsx` (390), `EntityFlow.tsx` (319), `ActiveDataReport.tsx` (300), `ActorHistory.tsx` (289), `ActorInstances.tsx` (264), `ColorPickerModal.tsx` (258), `ConstellationsPage.tsx` (247), plus `Footer.tsx` (211) and `Tooltip.tsx` (198), which are surprisingly large for their roles. Split opportunistically when touching these files — no big-bang refactor.
- **JuniorPane descendant slice → parent links** — `src/components/atlas/JuniorPane.tsx` selects descendants by doc_no prefix (now annotated `// fragile: doc_no prefix`). Migrate to parent-link traversal over `flatNodes` when convenient.
- **Manual browser verification of the audit fixes** — not runnable in the headless audit environment: glossary tab recovers after a transient `glossary.json` failure; search shows an error state (not an eternal spinner) when `search-index.json` is missing; `/admin/palette` Copy Snippet includes saved overrides after a reload; JuniorPane breadcrumb middle-click opens the right URL.
- **History metrics backfill** — run `pnpm build:history --full` once migration `006_history_metrics.sql` is applied so existing `atlas_history` rows gain `change_kind` / review counters (new rows get them automatically).

### Other / background
