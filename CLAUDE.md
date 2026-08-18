# Redline Atlas

A search-first interface for the Sky ecosystem's [next-gen-atlas](https://github.com/sky-ecosystem/next-gen-atlas). The atlas is included as a git submodule at `vendor/next-gen-atlas/`; source documents live at `vendor/next-gen-atlas/content/**`. **Upstream has regrouped those files twice and will again — never assume a file layout.** All three layouts are supported and detected, never guessed: a single composed `Sky Atlas/Sky Atlas.md` (pre-#236), one `document.md` per node (atomized, #236–#294), and ~16 composed files in `content/` — one per top-level Scope plus one per Agent artifact (consolidated, [#294](https://github.com/sky-ecosystem/next-gen-atlas/pull/294) on). The markdown *syntax* is unchanged across all three; only the grouping differs. Layout knowledge lives in exactly two modules and nowhere else: `scripts/lib/atlas-source.mjs` (working checkouts — mirrors upstream's `sync/atlas_source.py`) and `scripts/lib/atlas-git-source.mjs` (git tree-ishes, for the per-commit history walk). Both **throw** on an unrecognised or implausibly small checkout rather than falling back — an empty parse must never be read as "some other layout", because that is also what a truncated clone looks like. Prove a new regrouping is content-neutral with `node scripts/aux/ab-parse-check.mjs <dirA> <dirB>` (compares all 9 node fields). Atlas-derived artifacts (`docs.json`, `graph.json`, `relations.json`, `search-index.json`, `glossary.json`, `addresses.atlas.json`, `manifest.json`, `history/`) are **not committed to git** — they are built ephemerally at container startup (by the Dockerfile) or synced into Postgres (doc content + history + embeddings, by the Railway atlas worker service). The in-process updater polls `sync_state.atlas_sha` and rebuilds in-memory indexes from DB rows on drift — no git access needed at runtime.

**Atlas Markdown syntax reference**: `vendor/next-gen-atlas/ATLAS_MARKDOWN_SYNTAX.md` — canonical spec for heading format, document numbering, document types, extra fields, and nesting rules. Read this before touching the parser.

## Commands

```bash
pnpm build:index     # parses content/** → public/docs.json + public/search-index.json + public/addresses.atlas.json (chain only; annotation added by build-graph)
pnpm build:glossary  # extracts Definitions sections → public/glossary.json
pnpm build:addresses # chainlog + Etherscan enrichment → public/addresses.json (on-chain fields only)
pnpm snap:chainstate  # viem multicall snapshots → upsert the single-row chain_state table in Postgres (needs DATABASE_URL; refuses to replace a good snapshot with an empty fetch). Deliberately OFF the `pnpm build` chain: the Railway atlas worker runs this on its own time gate (CHAINSTATE_REFRESH_SECONDS, default daily) and the frontend reads it back through GET /api/chain-state. This entry point is the manual fetch→DB escape hatch.
pnpm build:graph     # Phase 2.6 annotates addresses; relation extraction → public/graph.json + public/relations.json; Phase 4.5 enriches public/addresses.atlas.json
pnpm build:history   # git log of atlas submodule → upsert atlas_history in Postgres (DB sink, reads its own incremental cursor); ALSO upserts the committed public/history-html-era.json (pre-#117 HTML-era reconstruction) AND public/history-pre-era.json (pre-git origins, if present) idempotently each run so dev + Railway serve them; add --out-json to write public/history/<uuid>.json instead (DB-less, used by canary tests); --full forces a full walk
pnpm prehist:genesis  # (ancient-history branch) bridges the recovered Atlas v2 genesis snapshot (2024-09-02) to the repo's real root commit → public/history-pre-era.json; see scripts/prehist/HISTORY.md
pnpm prehist:mip      # (ancient-history branch) attributes genesis-bridged docs to the MIP-era Atlas (2023-2024), appends into public/history-pre-era.json; run after prehist:genesis
pnpm prehist:aep      # (ancient-history branch) replaces select severed placeholders with dated Atlas Edit Proposal facts (only Accepted AEPs); run LAST, after prehist:genesis + prehist:mip
pnpm build:manifest  # sha256 digest of all artifacts → public/manifest.json
pnpm build:at        # reproducible build at a specific atlas commit
pnpm pull-atlas      # git submodule update --init --recursive (populate submodule after a shallow clone)
pnpm atlas:worker    # full atlas worker cycle: drift check → build → sync all Postgres tables
pnpm dev             # vite dev server (requires artifacts built first — see Local dev below)
pnpm preview         # serve the production build locally
pnpm build           # frontend pipeline: index → glossary → addresses → graph → oea-report → manifest → bundle → tools → tsc → vite (the chain is declared in scripts/lib/build-steps.mjs)
REPRO=1 pnpm test    # reproducibility check — two builds at the same atlas SHA must be byte-identical
pnpm test:snap       # graph snapshot tests — fail if relations.json structure changed (graph-snapshots/)
pnpm test:snap:update  # update graph snapshots after a deliberate atlas PR or build-graph change
pnpm check:atlas     # MERGE GATE for atlas bumps: refuses a build that didn't read the whole atlas. Recounts documents in the source by a deliberately dumb, layout-blind scan (line-anchored `id:` frontmatter / `<!-- UUID: -->` headings over every `content/**.md`) and requires an exact match with public/docs.json, plus an absolute floor. The recount is INDEPENDENT of atlas-source.mjs on purpose — the failure class is the loader not recognising the layout, so a check that asked the loader would just agree with itself. `--against <atlas-sha>` also fails a bump that drops more than ATLAS_MAX_DOC_DROP (default 10%) of documents. Runs in atlas-update.yml BEFORE the PR is opened (a bad bump never becomes a mergeable PR), in ci.yml as a PR check, and in atlas-healer.yml against main.
pnpm census:check    # coverage census: warn ([drift]) when uncovered structure clusters appear/grow vs .github/atlas-census-baseline.json; --update rewrites the baseline (atlas-update.yml does this per bump). Always exits 0.
pnpm census:govops   # GovOps report recall census: buckets every GovOps-mentioning doc (row / excluded-by-rule / residue), warns ([drift]) on residue docs not in .github/govops-census-baseline.json — i.e. new GovOps phrasings graph-duties.mjs doesn't recognize; --update rewrites the baseline (atlas-update.yml does this per bump). Always exits 0.
pnpm census:risk     # Risk Rules Assessment backlog census (runs under bun): buckets every risk candidate (fresh / rejected-by-triage / backlog), warns ([drift]) on backlog rows not in .github/risk-census-baseline.json — i.e. new/changed risk paragraphs `pnpm risk:assess` hasn't caught up with yet; --update rewrites the baseline (atlas-update.yml does this per bump). Always exits 0.
pnpm settlements:parse # fetch soterlabs/settlement-reports xlsx (or `--dir`) → public/settlements.json + coverage/reconciliation stats. Off the `pnpm build` chain (REPRO=1 is offline). Radar's Monthly settlement section reads that file; the Docker image bakes `dist/settlements.json` the same way after `build:vite` (a fetch failure hides the charts, it does not fail the image).
pnpm chains:add      # resolve a chain from ethereum-lists/chains (the dataset behind chainid.network, via its gh-pages mirror) and write its entry into src/data/chain-registry.json — the single source of truth all four chain structures derive from. Verifies the chainId with an eth_chainId round-trip and refuses a half-entry when the source lists no explorer or no key-free RPC. `--dry-run` prints without writing; `--no-verify` skips the round-trip. Deliberately OFF the `pnpm build` chain: the build is offline + deterministic (REPRO=1), so the fetch happens here and the result is committed as data.
pnpm census:chains   # chain registry census (runs under bun, imports src/lib/explorer.ts + tokens.ts): every chain string the pipeline reads — `Token Address (X)` titles, `Network`/`Integration Partner Chain` params, the multisig `address of ... on X is` regex — plus an inverted prose scan for `<Proper Noun> Chain|Network|Mainnet|Rollup|L2`, plus an address-anchored scan (`scripts/lib/chain-candidates.mjs`) for chain-keyed address lists with a row naming no known chain — the half that catches single-word chain names in plain bullet rows, which the other two structurally cannot see. All bucketed known / deferred (FUTURE_TO_ETHEREUM) / unknown. Warns ([drift]) on unknown chain strings not in .github/chains-census-baseline.json — i.e. the atlas named a chain the registry would silently collapse to ethereum — and on an incomplete registry entry (missing explorer / proseHints / nativeToken / chainId / rpcUrl; each is its own silent failure — wrong explorer, never-attributed prose, no balances) or a broken derivation. Also reports per-chain attributed address counts from addresses.atlas.json, so "seen in this atlas build" reflects what the pipeline concluded rather than only what the label scan could parse. `--update` rewrites the baseline (atlas-update.yml does this per bump); `--rpc` additionally round-trips eth_chainId against every rpcUrl. Always exits 0.
pnpm census:concepts # Atlas CrossView Concepts catalog census (runs under bun, imports src/lib/conceptsCensus.ts): recomputes the 9 deterministic censuses backing docs/crossview/concepts.md (registry liveness, empty scaffolding, ghost doc types, transitionary measures, formulas, numbered-step docs, prohibition language, title templates, cross-scope duplication), warns ([drift]) on new/changed members vs .github/concepts-census-baseline.json; --update rewrites the baseline (atlas-update.yml does this per bump). Always exits 0.
```

### Local dev

```bash
pnpm dev
```

`pnpm dev` is one-command: a preflight (`scripts/aux/dev-preflight.mjs`) runs, in order: `pnpm install` (only when `pnpm-lock.yaml`'s content hash changed — stamped in `node_modules/.dev-deps-hash`, so the steady state pays no install); ensures the Docker daemon is up (launches Docker Desktop on macOS, instructs on Linux); brings the Postgres container up + healthy (`docker compose`); runs the atlas worker in `--no-fetch` mode to sync Postgres to the **checked-out** atlas commit (build index+graph → `sync.ts` → history; embeddings only if an API key is set); and builds the atlas artifacts (`docs.json`, `graph.json`, `relations.json`, `glossary.json`, `search-index.json`, `addresses.atlas.json` — none committed) if they're missing. Then it starts the Bun API server + Vite together.

Local dev builds the **checked-out** submodule commit, NOT `origin/main` — advancing to upstream is the cron worker's job (`pnpm atlas:worker`, no `--no-fetch`). Syncing the DB to the checked-out commit also stops the in-process updater from looping to drag live back to a stale local `sync_state.atlas_sha`.

Escape hatches: `DEV_NO_INSTALL=1` (skip the install check), `DEV_NO_WORKER=1` (DB up but skip the atlas sync; the server migrates at boot), `DEV_NO_DB=1` (skip Docker/Postgres entirely — reader works off disk artifacts; history/chat/preview need a DB), `DEV_NO_BUILD=1` (skip the artifact build). After a shallow clone run `pnpm pull-atlas` first to populate the submodule.

### Process inventory scripts

The curated process inventory (`public/processes.json` + `public/processes-ignored.json`) is reconciled against atlas drift by the `processes:*` scripts, which are off the `pnpm build` chain. See `.claude/skills/processes-triage/SKILL.md` ("Entry points") for which are human entry-points vs CI-only, and the triage runbook.

### Atlas healer (weekly drift sweep)

`.github/workflows/atlas-healer.yml` runs Mondays: rebuilds artifacts, runs every census in verify mode (no `--update`), reconstructs what the hourly atlas bumps auto-accepted that week, verifies graph snapshots, sweeps failed atlas-update runs, and opens an `atlas-health` issue whose `@claude` mention triggers triage via `.claude/skills/atlas-healer/SKILL.md` (the silence-ordered checklist + fix-PR-vs-finding rules). It also opens the `processes-review` issue when the inventory is dirty — `processes-autoclose.yml` closes it. Build-side tripwires live in `scripts/lib/graph-tripwires.mjs`: `[drift] tripwire:` stderr lines when a structural gate (doc_no regex or `type ===` filter) matches zero docs, and bucketed `[drift-count]` stderr lines for unresolved-counter regressions — both flow into the same warnings-baseline diff atlas-update.yml uses.

## Architecture

### Data pipeline

Each build pass is its own script. They run in order in `pnpm build`:

Scripts are split: `scripts/required/` holds the build pipeline entry-points wired into `pnpm build:*`; `scripts/lib/` holds shared modules (parsing, regexes, extraction phases) imported by those entry-points — plus `atlas-html.mjs`, `history-identity.mjs`, `ordered-containment.mjs`, and `run-thread.mjs`, HTML-era parsing/matching primitives shared between `scripts/htmlhist/` and `scripts/prehist/` (same reasoning as `history-classify.mjs` below); `scripts/aux/` holds offline / one-off / experimental scripts (`tva.sh`, `add-chain.mjs` — the `chains:add` fetcher, deliberately off the build chain since it hits the network — `coverage-areas.mjs` — the CI coverage meter, not a build entry-point — etc.) that are not part of the core build chain; `scripts/assess/` and `scripts/eval/` are their own feature subsystems (not one-offs): the OEA/risk LLM-assessment pipeline (`assess-*.ts`, `oea:assess`/`risk:assess`) and the chat eval/verifier harness (`eval-*.ts` + `eval-corpora/`, `eval:*`) respectively; `scripts/htmlhist/` is the self-contained HTML-era history reconstruction feature (the `htmlhist:*` entry-points + their exclusive libs + `HISTORY.md` runbook), off the `pnpm build` chain; `scripts/prehist/` is the sibling pre-git-origins reconstruction feature (the `prehist:*` entry-points, run on the `ancient-history` branch — see `scripts/prehist/HISTORY.md`), also off the `pnpm build` chain.

- **`scripts/required/build-index.mjs`** — parses `Sky Atlas.md`, emits `public/docs.json` (`Record<uuid, AtlasNode>`), `public/search-index.json` (serialized MiniSearch index), and a minimal `public/addresses.atlas.json` (`{ addr: { chain } }`). Annotation (roles, labels, tokens) is deferred to `build-graph` Phase 2.6. Imports `lib/atlas-parser.mjs`, `lib/address-chains.mjs`.
- **`scripts/required/build-glossary.mjs`** — finds all `Definitions` sections, collects direct `[Core]` children as terms, emits `public/glossary.json` keyed by lowercased term.
- **`scripts/required/build-addresses.mjs`** — fetches Sky chainlog, calls Etherscan `getsourcecode` per unique address (read-through disk cache at `.cache/etherscan/<chainid>/<addr>.json`), emits `public/addresses.json` (on-chain fields only: `chain`, `chainlogId`, `etherscanName`, `isContract`, `isProxy`, `implementation`). Does **not** delete `public/addresses.atlas.json`. Imports `lib/address-enrich.mjs`.

**Address artifact split:**
- `public/addresses.atlas.json` — atlas-derived: `chain`, `explorerUrl`, `roles`, `entityLabel`, `aliases`, `expectedTokens`. Written by `build-index`, enriched by `build-graph` Phase 4.5. Permanent artifact.
- `public/addresses.json` — on-chain: `chain`, `chainlogId?`, `etherscanName?`, `isContract`, `isProxy`, `implementation?`. Written by `build-addresses`. Never contains atlas annotation fields.
- Frontend `loadAddresses()` loads both in parallel, merges per-address, resolves `label = chainlogId ?? entityLabel ?? etherscanName`.

- **`scripts/required/build-graph.mjs`** — pattern-driven relation extraction. **Phase 2.6** (before entity extraction) scans all doc content for addresses and applies structural role/label/token annotation — this replaces what was previously in `build-index`. **Phase 2.5** scans Instance entities for address-valued ICD params and emits `has_address` edges. **Phase 4.5** (five passes) enriches `public/addresses.atlas.json` with ICD-derived roles and labels, entity-linked labels, doc-title labels, and chainlog fallback. Emits `public/graph.json` and `public/relations.json`. No loopback to build-index. See `.claude/skills/parse-atlas/SKILL.md`. Imports `lib/graph-patterns.mjs`, `lib/graph-instances.mjs`, `lib/graph-entities.mjs` (Phase 1), `lib/graph-doc-edges.mjs` (Phase 2 doc edges 2a–2h), `lib/graph-entity-edges.mjs` (Phase 2 entity/address edges 2i–2x), `lib/graph-multisigs.mjs`, `lib/graph-transfers.mjs`, `lib/graph-bridges.mjs`, `lib/graph-omni.mjs`, `lib/graph-transitions.mjs` (Phase 2.8 patterns 17/18/21/22/23), `lib/address-chains.mjs`, `lib/address-annotate.mjs`.
- **`scripts/required/build-history.mjs`** — walks git log of the atlas submodule and computes per-node change history with diffs. Two sinks: **default** upserts straight into Postgres `atlas_history` (reads its own incremental cursor via `MAX(commit_seq)`, runs under Bun); **`--out-json`** writes the legacy `public/history/<uuid>.json` files (DB-less, for the canary/artifact tests). Shared DB write path lives in `src/server/history/history-db.ts` (`eventToRow`, `upsertHistory`, `gitCommitSeq`, `readHistoryCursor`). Imports `lib/atlas-parser.mjs` for `HEADING_RE`.
- **`scripts/required/build-manifest.mjs`** — sha256 digest of every shipping artifact.
- **`scripts/required/build-at.mjs`** — reproducible build at a pinned atlas commit; orchestrates the other `build:*` scripts.

**The step list itself is declared once, in `scripts/lib/build-steps.mjs`.** Eight sites run some slice of this chain (`package.json`'s `build`, the Dockerfile builder stage, `build-at`, `refresh-atlas-build`, `dev-preflight`, `atlas-worker`, `src/server/atlas-updater.ts`, `src/server/preview/build.ts`) and they legitimately run *different* slices — so the file exports a canonical ordered `STEPS` plus one named `PROFILES` entry per site, each carrying a comment for what it opts out of and why. Every JS orchestrator iterates its profile; the two that can't import it (package.json, the Dockerfile — including the Dockerfile's hand-maintained `gzip` artifact list) are parsed and asserted against their profile by `scripts_tests/build-steps.test.ts`. Add a build pass by adding a step + editing the profiles that should run it, never by hand-editing one call site.

Heading regex (each node):

```
^(#{1,6}) ([\w.-]+) - (.+?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->$
```

Each node has: `id` (uuid), `doc_no` (e.g. `A.0.1.1`), `title`, `type`, `depth` (heading level 1–6, **capped at 6** — semantic depth from the doc number may exceed 6), `parentId`, `order`, `content`, `addressRefs`. Parent IDs are resolved via a depth-indexed ancestor stack.

**Atlas document types** (from the syntax spec): Scope, Article, Section, Core, Type Specification, Active Data Controller, Annotation, Action Tenet, Scenario, Scenario Variation, Active Data, Needed Research. Supporting documents (Annotations, Action Tenets, Scenarios, Scenario Variations, Active Data) use special directory-number patterns (`.0.3.X`, `.0.4.X`, `.1.X`, `.varX`, `.0.6.X`). Needed Research uses global `NR-X` numbering.

`cleanContent()` strips wrapping single-backtick markers from multi-line backtick blocks (an Atlas authoring quirk) — but does NOT remove code/backtick _content_.

### On-chain address extraction

See `.claude/skills/address-extraction/SKILL.md` for the full reference: EVM/Solana regex patterns, the load-bearing hex-boundary lookarounds, chain detection algorithm, `ROLE_VOCAB` classification, and the sync constraint between `address-chains.mjs` and `NodeContent.tsx`.

**Chain registry — `src/data/chain-registry.json` is the single source of truth.** Four structures derive from it and must never be hand-maintained: `CHAINS` + `FUTURE_TO_ETHEREUM` (`scripts/lib/chains.mjs`), `CHAIN_HINTS` (`scripts/lib/address-chains.mjs`), `EXPLORER` (`src/lib/explorer.ts`), `NATIVE_TOKEN` (`src/lib/tokens.ts`). They were four separate lists until every one of them was shown to fail silently when missed — wrong explorer, never-attributed prose, no balances. Add a chain with `pnpm chains:add <name>`, not by hand, and run `pnpm census:chains` after. Order in the file is load-bearing (ethereum last for label matching; `CHAIN_HINTS` derives the reverse) — see the `$order` note in the JSON.

### Frontend

`App.tsx` is the shell (routing, URL sync, layout). The main atlas view is `src/components/atlas/AtlasView.tsx`.

Three workers: `search.worker.ts` (MiniSearch), `atlas.worker.ts` (tree view), `graph.worker.ts` (graphology `MultiDirectedGraph` over `relations.json`). The atlas view is `src/components/atlas/`, the entity view `src/components/radar/` (`/radar`, `/radar/:slug`), reports `src/components/reports/`.

Non-obvious behaviours:

- **Search phrase post-filter** — `"quoted"` phrases are stripped before the MiniSearch query, then every hit is re-checked for literal substring containment.
- **Depth ≥ 6 nodes are hidden** behind a "view all descendants" button until expanded (`CollapsibleNode.tsx`) — a consequence of the depth cap above.
- **Glossary lookup flattens parenthetical aliases** — `"Accessibility Scope (ACC)"` yields keys for both `"accessibility scope"` and `"acc"`.
- **Report data logic lives in pure `src/lib/*` modules, not in the components**, so it's testable without React. Keep it that way when adding one.
- **Stale Dates recomputes client-side** from `docs.json` + the actual date on every visit — no build step, no worker — so it can't serve a stale view.

**When adding a new report** (a new `/reports/<slug>` route, `ReportId`, `src/components/reports/*` page, or `src/lib/*Index.ts` module), read and follow `.claude/skills/new-report/SKILL.md` (skill: `new-report`) — the checklist for CSV export, URL-synced filtering, in-report search, analytics, result counts, and registration that every report must satisfy. Report pages build on the shared harness: `ReportShell.tsx` owns the page chrome (title, filter summary, count/CSV row, loading/no-rows states, `report_view`) and the `useReportQuery.ts` hooks own URL-synced filter state + the one canonical `report_filter` event — never hand-roll either.

**Graph snapshots (`graph-snapshots/`):**

Vitest snapshot tests that record the current state of `relations.json`. Run `pnpm test:snap` to verify no drift; run `pnpm test:snap:update` to accept deliberate changes. Uses `vitest.snap.config.ts` (separate from the main `vitest.config.ts` which excludes this folder).

### Base path

`vite.config.ts` sets `base: '/'` — the app is served from the domain root on Railway. GitHub Pages is only a redirect stub (`gh-pages-redirect/`, the one place `/redlens/` survives), not a deployment target, so there is no non-root base variant anymore.

`import.meta.env.BASE_URL` is therefore always `"/"`. Existing references still work (they evaluate to `"/"`) and don't need stripping, but new code can use root-relative paths directly. Note the distinct **data-source base** abstraction (`src/lib/atlasBase.ts` `liveAtlasBase()`, `src/lib/dataSource.tsx`): atlas-versioned artifacts are served under `/api/atlas/<sha>/` (or a preview base) and fall back to `import.meta.env.BASE_URL` — that base parameter is unrelated to `/redlens/` and is load-bearing for sha-keyed/preview serving.

### Styling

Color tokens live as CSS variables in `src/index.css` (charcoal-with-red-undertone bg, red/accent, tans); the `ui-look-and-feel` skill covers the full token system and the `/admin/palette` editor. The one value worth stating here: `--accent` (links/focus) is deliberately browner-pinker — _not_ the original error-looking red.

Selected-node treatment: red left bar, brighter text, plus a subtle muted-red fill (`--bg`) that sits against the deeper reader/sidebar bg (`--bg-deep`). (Earlier guidance said "never add a background to the selected node" — that was reversed intentionally once the reader adopted the deep bg; the soft `--bg` tint is now the selected marker alongside the bar.)

## Conventions / preferences

- **Two lockfiles, both must stay in sync with `package.json`: `pnpm-lock.yaml` (frontend build/CI, via pnpm) and `bun.lock` (server + the Dockerfile/Railway build, via `bun install --frozen-lockfile`).** Adding/bumping a dependency with only `pnpm add`/`pnpm install` leaves `bun.lock` stale — `bun install --frozen-lockfile` then fails in the Docker build (Railway) even though pnpm-side CI is green. Run `bun install` too (or `pnpm install && bun install`) after any `package.json` dependency change, and check both lockfiles into the same commit.
- **Use semantic HTML elements**: `h1`–`h6` for headings, `<button>` for actions, `<a>` for navigation, `<article>`/`<section>`/`<header>` for sectioned content. Prefer native elements over `<div>`/`<span>` with ARIA roles when a semantic element fits.
- **Don't add hover/click logic in JS when CSS will do it.**
- **The home button is a plain HTML link** (`<a href="/">`), not an `onClick` handler.
- **Search quality > bundle size** for the MiniSearch index. Full-content indexing is intentional.
- **Scroll-to is a fast fixed-duration glide** (`src/lib/animatedScroll.ts`): 220ms ease-out over the full distance, so duration never grows with distance. Never use native `behavior: "smooth"` — the user found it sluggish. Reduced-motion falls back to instant.
- **Sticky header collisions**: any scroll target needs `scrollMarginTop: "64px"`.
- **Don't override git user.name/email.** Trust global config.
- **Show stats before touching the UI** when changing the build pipeline. The user wants to see counts/samples before any visual change consumes new data.
- **Keep `patch-notes.md` (repo root) current, but not noisy.** It backs the homepage "Recent improvements" log. When a change ships a user-visible feature or fix, add a one-line bullet in the same PR. If you are modifying or extending something that was just added today / in the same unreleased PR, do **not** add another bullet for the follow-up; treat it as part of the same unreleased feature. If the follow-up significantly changes what users will experience, revise the existing bullet instead of adding a second one (for example, do not add "Improved chatbot search" right after "Added Chatbot" unless the original note needs to be broadened). Date each `## YYYY-MM-DD` group by **the day the change becomes public** — the day it deploys/merges to main, or the day its feature flag is turned on — **not** the day the PR opens; newest date first. Write each bullet **for the end user**: past-tense verb + object, plain language describing something a user would find interesting (e.g. "Added a Stale Dates report", "Lightened colors for better visibility") — never dev/PM framing. Format is enforced by `pnpm check:patch-notes` (pre-commit hook + CI), which requires strict newest-first dates.
- **Keep the Features guide (`src/components/featuresData.ts`) in sync — it is the single source of truth for "what can this app do".** It backs `/features`, the page the home page's "New here?" banner and the feedback modal's "Everything you can do" link both point at, so anything stale there is stale for every first-time user. Whenever a PR ships a **user-visible** capability — a new route or page, a new report, a new panel/tab, a new gesture or keyboard affordance, a new query-syntax feature, a new MCP surface — add or update its entry in the same PR, alongside the `patch-notes.md` bullet. The two are not redundant: patch notes say *what changed and when*, the Features guide says *what exists and how to use it*. Rules for entries:
  - Name the **real control** the user has to find ("the save (disk) icon", "the `Selected · N` pill"), not an abstraction. If you rename or move a control, grep `featuresData.ts` for its old name.
  - **Never hardcode a count the app derives elsewhere** (number of reports, number of MCP tools). Those drift within days — `ReportsIndex.tsx` owns the report list and `/connect` reads the live tool count. Describe the set instead of counting it.
  - Gesture copy must match `src/lib/hintText.ts` — that's the wording the footer hint shows on the same control.
  - Anything behind a flag or per-environment (chat, sign-in providers, preview) belongs in `note`, phrased so it stays true in a deployment where the flag is off.
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

- **Split oversized component files** — 31 component files exceed the ~150-line convention (recounted 2026-08-14; the 2026-08 cleanup waves absorbed the previous top offenders — OpFacilitators/OpGovOps merged into one parameterized role-report, ProcessesReport/ActiveDataReport shrank under ReportShell, Footer was split). Current top offenders: `AtlasReader.tsx` (696), `TreeSidebar.tsx` (513), `CollapsibleNode.tsx` (465), `ActorHistory.tsx` (437), `EntityFlow.tsx` (334), `RightPanel.tsx` (301), `ActorInstances.tsx` (282), `ConstellationsPage.tsx` (254). The three biggest (AtlasReader/TreeSidebar/CollapsibleNode) were explicitly deferred in the 2026-08 cleanup — split opportunistically when touching these files, no big-bang refactor.
- **Manual browser verification of the audit fixes** — not runnable in the headless audit environment: glossary tab recovers after a transient `glossary.json` failure; search shows an error state (not an eternal spinner) when `search-index.json` is missing; `/admin/palette` Copy Snippet includes saved overrides after a reload; JuniorPane breadcrumb middle-click opens the right URL.
- **History metrics backfill** — run `pnpm build:history --full` once migration `006_history_metrics.sql` is applied so existing `atlas_history` rows gain `change_kind` / review counters (new rows get them automatically).

### Chat reliability harness (docs/plans/chat-reliability-harness.md)

- ~~Wire in verifier-slices~~ **Done 2026-08-06**: `verify/sliced-verifier.ts` runs the 4 slices concurrently as the only audit path (the `CHAT_VERIFIER_MODE` single/sliced switch was removed 2026-08-12 — nothing ever set it; `verifier.ts`'s `runVerifier` survives solely for `pnpm eval:verifier`; per-slice models via `CHAT_VERIFIER_SLICE_MODELS="claims=m1,…"`). Bakeoff (2026-08-06, `.cache/eval-slices.json`): **gemma-4 wins every slice** — the slicing itself fixed its single-prompt flake (parse 87–100% sliced vs ~50% single); gpt-5-mini regressed (58% parse, 67s p50), inkling-small unusable on evidence slices (spanKill 91 on figures). Keep `CHAT_VERIFIER_MODEL` as gemma, no slice overrides. `figures` is every model's weak slice (FPR 30–50%) — the deterministic parameter table (docs/research/synlang-wiki.md §3.1) is the planned fix, not a better model.
- ~~Wave 2: parameter table / liveness / absence contract~~ **Done 2026-08-07** (STATUS notes in synlang-wiki.md §3.1/§3.2): `src/lib/paramIndex.ts` (1,019 rows) + `src/lib/liveness.ts` (1,224 tags) are derived in `buildIndexes()` — never stale vs served docs, no healer dependency; `atlas_params` tool + liveness tags/hint on tool-result rows; verifier side gains `findParamMismatches` (hard deterministic fail), the absence-claim contract (`verify/absence.ts` refuted/grounded/unverified — replaces the blanket absence exemption), `[E-const]` param evidence (verifier-only, never the answerer prompt), and `RoundTelemetry.semanticSkips`. Remaining wiki-plan parts (v2 card rerun, attach-on-hit, Phase 2, A.6 rollup) are DEFERRED pending further investigation — status ledger at the top of docs/research/constraints-wiki.md; do not build them without a new decision.
- ~~Staged delivery~~ **Implemented 2026-08-07** (docs/plans/chat-staged-delivery.md has the live shape): `CHAT_DELIVERY_MODE`/body `delivery` switch on the SSE route (staged = suppress token/clear, synthetic `synthesizing`/`finalizing` stages, `comparing` from the orchestrator), client stage checklist + `useRevealOnDone` display-stream + "staged" pref toggle. **Default stays `streaming`** until the staged-vs-streaming A/B (PostHog `chat_delivery` property) measures — don't flip it without that.

### Other / background
