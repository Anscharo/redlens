# RedLens — Sky Atlas

A search-first reader for the [Sky Atlas](https://github.com/sky-ecosystem/next-gen-atlas), the canonical document describing the Sky ecosystem's structure, governance, and operations.

An alternative to [sky-atlas.io](https://sky-atlas.io) with a focus on surfacing the on-chain reality behind the governance text.

## Stack

- **Build/dev**: Vite+ + pnpm + TypeScript
- **UI**: React 19 + Tailwind v4
- **Search**: MiniSearch (full-content index, runs in a Web Worker)
- **Markdown**: react-markdown + remark-gfm + KaTeX; custom rehype plugin linkifies on-chain addresses
- **Graph**: graphology (Web Worker) for typed entity/document relationships

## Features

### Search

- **Full-content search** — every node of the Atlas is indexed (MiniSearch, Web Worker), so queries hit the entire ~50k-line corpus instantly
- **Chainlog ID search** — type `MCD_VAT`, `USDS`, `REWARDS_LSSKY_SKY`, etc. to find all nodes that reference that contract
- **Address prefix search** — type `0x` or any address prefix to find nodes containing matching addresses
- **Phrase search** — wrap terms in quotes for exact substring matching: `"surplus buffer"`
- **Field filters** — `title:quorum`, `type:Annotation`, `type:Core`
- **Fuzzy match** — `misaligment~1` tolerates typos
- **Wildcards** — `govern*` matches any suffix

### Atlas reader

Navigate any atlas document to see its full content alongside a contextual annotations panel: linked documents, on-chain addresses, glossary terms, and a change history tab.

### On-chain annotations

Every Ethereum and Solana address mentioned in the Atlas is detected at build time and enriched from two sources:

- **Sky chainlog** — ~400 mainnet contract names mapped to their canonical label
- **Etherscan** — verified contract name, proxy flag, and implementation address; cached and committed so contributors don't need an API key

Address cards show the resolved label, aliases, explorer link, role tags, proxy → implementation, and cached on-chain view-function values.

### Radar

`/radar` — actor profiles for Prime Agents, Facilitators, and other named Sky participants. Shows responsibilities, instances, rewards, and linked atlas sections.

### Constellations

`/constellations` — a visual graph of agents, governance parties, facilitators, and the typed relationships between them, drawn from the build-time graph extraction.

### Reports

`/reports` — cross-cutting views that join across the graph: rewards by primitive, active data by scope, and org facilitator breakdowns.

## Getting started

Requires [pnpm](https://pnpm.io/), Node 22+, and [Docker](https://docker.com) (for the local Postgres in `pnpm dev`; skippable with `DEV_NO_DB=1`).

```bash
git clone --recurse-submodules https://github.com/Anscharo/redlens.git
cd redlens
pnpm install
```

If you cloned without `--recurse-submodules`, run  `git submodule update --init --recursive` (aliased as `pnpm pull-atlas`) to pull the Atlas source.

### Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
ETHERSCAN_API_KEY=   # https://etherscan.io/apidashboard — needed for build:addresses
ETH_RPC_URL=         # optional; overrides the chains.mjs default for snap:chainstate
```

RPC endpoints live per chain in `scripts/lib/chains.mjs` (`CHAIN_RPC`, free public
endpoints) — `pnpm census:chains --rpc` checks each one still answers for the chain
id the registry claims.
The Etherscan cache is committed to the repo — if you're not adding new addresses, `build:addresses` completes in under a second with zero API calls.

### Build and run

```bash
pnpm dev     # one-command local env (see below)
pnpm build   # full production pipeline (see below) + tsc + vite build
pnpm preview # serve the production build locally
```

`pnpm dev` is self-contained: it installs deps if `pnpm-lock.yaml` changed, ensures the Docker daemon + local Postgres are up, syncs the DB to the checked-out atlas commit, builds the data files if missing, then runs the Bun API server + Vite together. It needs Docker for the local Postgres (launched automatically on macOS). Reader-only, no database: `DEV_NO_DB=1 pnpm dev` (other hatches: `DEV_NO_INSTALL`, `DEV_NO_WORKER`, `DEV_NO_BUILD`).

## Build pipeline

`pnpm build` runs six data-extraction stages in order before the TypeScript and Vite steps:

| Stage | What it does |
|---|---|
| `build:index` | Parses Sky Atlas.md → node index + full-text search index |
| `build:glossary` | Extracts Definitions sections → glossary lookup |
| `build:addresses` | Enriches on-chain addresses from chainlog + Etherscan → address metadata |
| `snap:chainstate` | Reads view-function values via RPC → chain state pinned to a block |
| `build:graph` | Extracts typed relationships from the atlas text → graph artifacts |
| `build:manifest` | sha256 digest of all artifacts → integrity manifest |

Each stage can also be run individually. 

### Build at any historical atlas commit

The atlas is a moving target. To audit RedLens against a specific atlas revision:

```bash
pnpm build:at <atlas-commit-sha>   # e.g. ede66d5f2cf3…
```

This runs only the deterministic, offline pipeline steps and pins the output manifest to the given commit. No API keys needed. Two people running the same command at the same SHA get byte-identical outputs. CI enforces this on every push via `REPRO=1 pnpm test`.

### Per-node history

```bash
pnpm build:history   # walks the atlas git history → public/history/<uuid>.json per node
```

This is not part of `pnpm build` — it's slow and requires GitHub API access for PR metadata. Run it manually when you want the history tab populated.

## Deployment

RedLens deploys two ways:

- **GitHub Pages — static reader.** `main` auto-deploys via `.github/workflows/deploy.yml` on every push to `main`, daily on a schedule, and on manual trigger. It serves the SPA reader only — no chat, no live atlas updates — and requires the repository secret `ETHERSCAN_API_KEY` when rebuilding address metadata.
- **Railway — full app.** A single web service plus a managed Postgres. The web service serves the reader SPA, the MCP endpoint, `api/health`, and the chat/OAuth endpoints, and runs an in-process self-updater that keeps the atlas text fresh between deploys (polls upstream, hot-swaps in memory, no restart). It builds from a `Dockerfile` — the Dockerfile clones the atlas itself, because Railway strips `.git` and doesn't recurse submodules. Step-by-step runbook: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Keeping the atlas up to date

The Sky Atlas is a git submodule at `vendor/next-gen-atlas/`. When the upstream atlas gets a new commit, trigger the **Atlas Update** GitHub Actions workflow (`.github/workflows/atlas-update.yml`) — it pulls the submodule, rebuilds all artifacts, and opens a PR.

## Other tools

These are not part of the web app build and are not required for local development.

### ask-atlas agent (Claude Code)

The repo ships a `.claude/agents/ask-atlas.md` subagent definition. In any Claude Code session opened in this directory, type `@ask-atlas` to ask governance questions about the Atlas with exhaustive inline citations:

```
@ask-atlas What does the Atlas say about USDS stability fees?
@ask-atlas Show me the Active Data sections controlled by Spark
@ask-atlas Does the Prime Agent Executor Agent requirement interact with the Allocation System?
```

The agent retrieves answers from the [hosted MCP server](#hosted-mcp-server--worker) (requires the `.mcp.json` connection). It also supports a `learn:` command for persisting external context (forum posts, legal opinions, off-chain agreements) that will be cited in future answers:

```
@ask-atlas learn: [paste content] (source: Sky Forum post by X, 2024-03-15)
```

External knowledge is saved to `.claude/agents/ask-atlas/EXTERNAL.md` and survives across sessions.

### Hosted MCP server

The live MCP server runs as part of the Railway app (`src/server/`) — a stateless streamable-HTTP transport mounted at `/mcp`, backed by the in-memory atlas indexes + Postgres, exposing the full atlas tool set (`atlas_search`, `atlas_get`, `atlas_describe`, `atlas_entities`, `atlas_get_address`, `atlas_neighbors`, `atlas_traverse`, `atlas_entity`, `atlas_filter`, `atlas_entity_params`, `atlas_history`, `atlas_recent_changes`, `atlas_pr`, `atlas_changed_between`, `atlas_query`). It's public and read-only — no API key or auth. The same tool registry (`src/server/chat/tools/tool-registry.ts`) backs both MCP clients and the `/api/chat` agentic loop, so they never drift.

**Endpoint:** `https://atlas.redline.support/mcp` (see `.mcp.json`)

Setup instructions for common clients live on the in-app **`/connect`** page. The tool registry is the source of truth for the tool reference.

> API note: `atlas_query` is lean by default (`enrich=false` → title/doc_no/snippet/sources); pass `enrich=true` for full document content + ancestor ids, or fetch specific docs with `atlas_get`.

> The earlier Cloudflare Worker (`redlens-mcp/`, `https://redlens-mcp.anscharo.workers.dev/mcp`) predates the Railway move and is no longer the connection RedLens uses.

### Auxiliary scripts

`scripts/aux/` holds scripts that are useful for development and research but are not part of the core build:

| Script | Purpose |
|---|---|
| `check-atlas-pr.sh` | Build the repo against a next-gen-atlas PR and diff artifacts (`pnpm check:pr`) |
| `tva.sh` | Full-history build + test sweep |
| `test-addresses.mjs` | Ad-hoc dumps from address metadata |
| `unlabeled-addresses.mjs` | Lists addresses with no resolved label for triage |
| `processes-triage.sh` | Reconcile the curated process inventory against atlas drift (`pnpm processes:triage`): syncs `main`, creates a branch, runs the `processes-triage` Claude skill interactively, then commits + pushes + opens a PR. Add `--dry-run` to skip git ops. Add `--issue N` to link the PR (`Closes #N`) to the `processes-review` issue opened by atlas-update.yml |
| `processes-apply-decisions.mjs` | Apply a `[{ uuid, verdict: "add" \| "ignore", ... }]` decisions file to `public/processes.json` + `public/processes-ignored.json` (`pnpm processes:apply-decisions <file>`). Consumed by the curation UI on `/reports/processes` (its "Download JSON" output drops in directly) and by the triage skill's batch path |
