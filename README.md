# RedLens — Sky Atlas

A search-first reader for the [Sky Atlas](https://github.com/sky-ecosystem/next-gen-atlas), the canonical document describing the Sky ecosystem's structure, governance, and operations.

An alternative to [sky-atlas.io](https://sky-atlas.io) with a focus on surfacing the on-chain reality behind the governance text.

## Features

### Search
- **Full-content search** — every node of the Atlas is indexed (lunr.js, Web Worker), so queries hit the entire ~48k-line corpus instantly
- **Chainlog ID search** — type `MCD_VAT`, `USDS`, `REWARDS_LSSKY_SKY`, etc. to find all nodes that reference that contract; results merge with prose matches
- **Address prefix search** — type `0x` or any address prefix to find nodes containing matching addresses
- **Phrase search** — wrap terms in quotes for exact substring matching: `"surplus buffer"`
- **Field filters** — `title:quorum`, `type:Annotation`, `type:Core`
- **Fuzzy match** — `misaligment~1` tolerates typos
- **Wildcards** — `govern*` matches any suffix

### On-chain annotations
Every Ethereum and Solana address mentioned in the Atlas is detected at build time and enriched from two sources:

- **Sky chainlog** — ~400 mainnet contract names (`MCD_VAT`, `USDS`, `SPK`, …) mapped to their canonical label
- **Etherscan** — verified contract name, proxy flag, and implementation address for each EVM address; cached in `.cache/etherscan/` and committed to the repo so contributors don't need an API key

Address metadata shown in the annotations panel for each node:
- Resolved label (chainlog ID wins, then atlas prose label, then Etherscan name)
- Aliases (other names found for the same address across the Atlas)
- Explorer link (Etherscan, Basescan, Arbiscan, etc. per chain)
- Role tags (`multisig`, `proxy`, `oracle`, `treasury`, `staking-rewards`, …)
- Proxy → implementation address
- **Live on-chain view function results** for chainlog contracts (via viem + multicall3, fetched at build time)

### Node detail view
Navigating to a node shows a bounded context window: the parent node, up to 8 siblings above, the target, up to 8 direct children, and up to 8 siblings below — never the entire subtree regardless of Atlas size.

The annotations panel (right column on desktop) shows:
- UUID-linked nodes from the Atlas cross-reference system
- Address cards with on-chain metadata and live view function values

## Build & run locally

Requires [pnpm](https://pnpm.io/) and Node 22+.

```bash
# clone with the Atlas submodule
git clone --recurse-submodules https://github.com/Anscharo/redlens.git
cd redlens
pnpm install
```

If you cloned without `--recurse-submodules`:
```bash
git submodule update --init --recursive
```

### Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
ETHERSCAN_API_KEY=   # https://etherscan.io/apidashboard — needed for build:addresses
ETH_RPC_URL=         # optional; defaults to ethereum.publicnode.com
```

The Etherscan cache (`.cache/etherscan/`) is committed to the repo. If you're not adding new addresses, `build:addresses` will complete in under a second with zero API calls.

### Build scripts

```bash
pnpm build:index      # parse Atlas markdown → public/docs.json + public/search-index.json
pnpm build:addresses  # enrich addresses with chainlog + Etherscan → public/addresses.json
pnpm build:snapshot   # fetch on-chain view function values → public/chain-state.json
pnpm build            # all of the above, then tsc + vite build

pnpm dev              # Vite dev server (requires build:index + build:addresses + build:snapshot first)
pnpm preview          # serve the production build locally
```

## Atlas MCP server (local)

This repo also ships a local [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes the Sky Atlas as queryable tools for Claude Code (or any MCP client). It uses a local vector index over `docs.json` so you can ask natural-language questions about the Atlas without sending any data off your machine.

Three tools are exposed:
- `atlas_search(query, k?, type?)` — semantic search over all 9,825 nodes
- `atlas_get(id)` — fetch a single node by UUID or doc number (e.g. `A.6.1.1.1`)
- `atlas_neighbors(id, window?)` — parent + sibling + child context around a node

### Setup

1. **Install [Ollama](https://ollama.com/)** and pull the embedding model (one-time, ~270 MB):
   ```bash
   ollama pull nomic-embed-text
   ```
   Ollama must be running at `http://localhost:11434` (the default). Override with `OLLAMA_URL` if you've moved it.

2. **Build the docs index** if you haven't already:
   ```bash
   pnpm build:index
   ```

3. **Build the vector index** (embeds all atlas nodes — takes a couple of minutes the first time):
   ```bash
   pnpm build:rag
   ```
   Output lives in `.cache/atlas-rag/` (gitignored). Re-run whenever `docs.json` changes.

4. **Use it.** The repo ships a `.mcp.json` at the root, so any Claude Code session opened in this directory auto-discovers the server. The first time you run a tool, Claude will prompt you to approve it.

### Smoke tests

```bash
node scripts/query-rag.mjs "what is spark"   # direct RAG query, no MCP layer
node scripts/test-mcp.mjs                     # exercise the JSON-RPC stdio protocol
```

### Notes

- Zero npm dependencies — the server uses only Node built-ins (`fs`, `readline`, `fetch`).
- The vector store is brute-force cosine over an L2-normalized `Float32Array` (~30 MB scan per query, fine for 9,825 nodes).
- Server logs go to stderr; stdout is reserved for JSON-RPC messages.
- Index is **not** auto-rebuilt by `pnpm build` because the web build shouldn't depend on Ollama being online. Run `pnpm build:rag` manually after `build:index` when you want to refresh it.

## Deployment

`main` is auto-deployed to GitHub Pages via `.github/workflows/deploy.yml`. The workflow:
- Runs on every push to `main`, daily on a schedule, and on manual trigger
- Pulls the latest upstream Atlas submodule content on each build
- Requires two repository secrets: `ETHERSCAN_API_KEY` and `ETH_RPC_URL`
