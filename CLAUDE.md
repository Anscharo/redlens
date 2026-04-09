# RedLens' Sky Atlas

A search-first interface for the Sky ecosystem's [next-gen-atlas](https://github.com/sky-ecosystem/next-gen-atlas). The atlas is included as a git submodule at `vendor/next-gen-atlas/`; the source document is `vendor/next-gen-atlas/Sky Atlas/Sky Atlas.md` (~48k lines, 9,825 nodes).

**Atlas Markdown syntax reference**: `vendor/next-gen-atlas/ATLAS_MARKDOWN_SYNTAX.md` — canonical spec for heading format, document numbering, document types, extra fields, and nesting rules. Read this before touching the parser.

## Stack

- **Build/dev**: Vite+ (`vp`) + pnpm + TypeScript
- **UI**: React 19 + Tailwind v4 (via `@tailwindcss/vite`)
- **Search**: lunr.js (full-content index, runs in a Web Worker)
- **Markdown**: react-markdown + remark-gfm + remark-math + rehype-katex (KaTeX)
- **Custom rehype plugin**: linkifies on-chain addresses to block explorers

## Commands

```bash
pnpm build:index   # parses Sky Atlas.md → public/docs.json + public/search-index.json
pnpm dev           # vite dev server
pnpm build         # build:index then tsc + vite build
```

The Vite+ binary lives at `~/.vite-plus/0.1.16/bin/vp` (it cannot be run via `pnpm dlx`).

## Architecture

### Data pipeline (`scripts/build-index.mjs`)

Parses the Atlas markdown and emits two artifacts:

- **`public/docs.json`** (~4.7 MB) — `Record<uuid, AtlasNode>`. Includes the full content of every node and a per-node `addresses` map.
- **`public/search-index.json`** (~13.7 MB raw, ~4.7 MB gzipped) — serialized lunr index. We chose full-content indexing over a two-tier approach because the user prefers search quality over bundle size.

Heading regex (each node):
```
^(#{1,6}) ([\w.]+) - (.+?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->$
```

Each node has: `id` (uuid), `doc_no` (e.g. `A.0.1.1`), `title`, `type`, `depth` (heading level 1–6, **capped at 6** — semantic depth from the doc number may exceed 6), `parentId`, `order`, `content`, `addresses`. Parent IDs are resolved via a depth-indexed ancestor stack.

**Atlas document types** (from the syntax spec): Scope, Article, Section, Core, Type Specification, Active Data Controller, Annotation, Action Tenet, Scenario, Scenario Variation, Active Data, Needed Research. Supporting documents (Annotations, Action Tenets, Scenarios, Scenario Variations, Active Data) use special directory-number patterns (`.0.3.X`, `.0.4.X`, `.1.X`, `.varX`, `.0.6.X`). Needed Research uses global `NR-X` numbering.

`cleanContent()` strips wrapping single-backtick markers from multi-line backtick blocks (an Atlas authoring quirk) — but does NOT remove code/backtick *content*.

### On-chain address extraction

Detected at build time, written into `node.addresses` as `Record<address, AddressInfo>`.

**Patterns:**
- EVM: `/(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g`
- Solana: `/\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g` (base58, 43–44 chars — assumed Solana by pattern alone)

The hex-boundary lookarounds on the EVM pattern are **load-bearing**: without them, the regex matches the leading 40 hex chars of any longer hex blob — transaction hashes (64 hex), bytes32 values, raw calldata — and ships those phantom addresses into `addresses.json`. Both `scripts/build-index.mjs` and `src/components/NodeContent.tsx` use the same boundary form and must stay in sync. If you change one, change both.

**0x + 64 hex values** (tx hashes, bytes32 constants, role IDs, domain separators, etc.) are **not linked** — they are visually identical and cannot be reliably distinguished from context.

**Chain detection (`detectChain`)** — three-pass priority:
1. Explicit phrase: `address on [the] CHAIN is` in the 120 chars before the address (most reliable signal — user explicitly asked for this).
2. Tight-window keyword scan (120 chars before).
3. Wide-window keyword scan (300 chars before).
4. Fallback: `ethereum`.

Supported chains/explorers: ethereum, base, arbitrum, optimism, polygon, avalanche, gnosis, solana.

**Address classification:** each address gets:
- `roles`: `string[]` — flat multi-tag array from a closed vocabulary (`ROLE_VOCAB` in `build-index.mjs`). Categories: affiliation (`sky`, `spark`, `maker`, `grove`, `external`), wallet type (`multisig`, `subproxy`, `hot-wallet`), contract type (`proxy`, `registry`, `oracle`), purpose (`treasury`, `buffer`, `reserve`, `vesting`, `vault`, `foundation`, `incentive-pool`, `staking-rewards`), governance (`signer`, `delegate`, `executor`, `controller`). An address can have multiple tags.
- `entityLabel`: best-effort proper-noun phrase pulled from the 200 chars before the address (e.g. `"Sky Frontier Foundation"`)
- `expectedTokens`: `string[]` of token symbols mentioned within ±300 chars (`USDS`, `DAI`, `SKY`, `MKR`, `sUSDS`, `stUSDS`, `USDC`, `ETH`, `WETH`, `SPK`, `GROVE`) — intended to drive viem `balanceOf()` calls

The eventual goal is to use viem to fetch actual token balances for addresses with `expectedTokens`, surfaced in the annotations panel.

### Frontend

App.tsx is the shell only (search state, nav state, URL sync). Everything else is in its own file under `src/components/`:

- **`src/workers/search.worker.ts`** — loads docs.json + search-index.json, runs lunr queries, generates highlighted snippets via match positions, returns all results (no slice). Falls back to wildcard on bad lunr syntax. Phrase post-filter: `"quoted"` phrases are stripped before the lunr query, then every hit is checked for literal substring containment. Uses `import.meta.env.BASE_URL` for fetch paths.
- **`src/hooks/useSearch.ts`** — debounced wrapper with a pending-id race guard. `search` is `useCallback`-stable.
- **`src/hooks/useScopes.ts`** — loads depth-1 nodes via `loadDocs()`; caches resolved scopes at module level.
- **`src/lib/docs.ts`** — `loadDocs()` module-level Promise cache for `docs.json`. Both `useScopes` and `NodeDetail` go through this, so navigating between nodes is a pure object lookup after the first load. Uses `import.meta.env.BASE_URL`.
- **`src/components/NodeContent.tsx`** — markdown rendering. The `components` map + `remarkPlugins` live at module scope (stable refs). `rehypePlugins` is `useMemo`'d on `addresses`. `onNavigate` is threaded via React context so the components map can stay out of the component body. Wrapped in `React.memo`. Custom `rehypeEthAddresses` plugin walks text nodes (skipping any inside existing `<a>` tags), splits at addresses, wraps them in `<a>` to the explorer URL from the address map. UUID hrefs are intercepted and routed via `onNavigate` for SPA navigation.
- **`src/components/NodeDetail.tsx`** — loads target via `loadDocs()` and renders a **bounded** context set, not the full subtree: parent (if any) → up to 8 siblings immediately above target → target → up to 8 direct children of target → up to 8 siblings immediately below target. "Siblings" = same `parentId`. Max ~26 ScopeNode renders per page regardless of atlas size. Also gathers UUID-linked nodes and the target's address map for the right panel.
- **`src/components/ScopeNode.tsx`** — single node in the left context list. `React.memo`. Scrolls to itself if `isTarget`. Depth-indexed indent via `DEPTH_INDENT`.
- **`src/components/RelatedNode.tsx`** — annotation card in the right panel (for UUID-linked nodes). `React.memo`.
- **`src/components/AddressCard.tsx`** — right-panel card for on-chain addresses: entity label + aliases + explorer link + role pills.
- **`src/components/SearchResult.tsx`** — search result card. `React.memo`. `dangerouslySetInnerHTML` for worker-produced highlighted snippet.
- **`src/components/SearchBar.tsx`** — header bar: home link, search input, scope filter pills.
- **`src/components/SearchResults.tsx`** — result list + status line. Filters by `activeScope` via `useMemo`.
- **`src/components/SearchHints.tsx`** — idle-state cheat sheet of search syntaxes.
- **`src/App.tsx`** — shell. Two-panel responsive layout `lg:grid-cols-[3fr_2fr]` (60/40 main/annotations split). `nodeId` is React state synced via `pushState` + `popstate`. All handlers are `useCallback`-stable so the memo'd children actually benefit. Every `pushState`/`href` prefixes `import.meta.env.BASE_URL` (vite config has `base: '/redlens/'`).

### Base path

`vite.config.ts` sets `base: '/redlens/'`. Any runtime string used as a URL (not an import Vite transforms) MUST be prefixed with `import.meta.env.BASE_URL`. This applies to `fetch(...)` in the worker and `src/lib/docs.ts`, the icon `<img src>` and home `<a href>` in `SearchBar`, all `pushState`/`href` that link to `?id=…`, etc. Hardcoded `"/"` paths will 404 in dev. This was the gotcha that broke `docs.json`/`icon-SMALL.png` loading during the perf pass.

### Performance posture (landed in commit `574e9cd`)

- `NodeContent` components map and `remarkPlugins` hoisted to module scope; `rehypePlugins` memoized; `React.memo` wrapper; `onNavigate` via context.
- Shared `loadDocs()` cache so `NodeDetail` doesn't re-fetch `docs.json` on every navigation.
- `React.memo` on `ScopeNode`, `RelatedNode`, `SearchResult`.
- `useCallback` for `navigate`, `handleChange`, `toggleScope`, `handleHintClick` in `App.tsx`.
- `useMemo` on filtered hits in `SearchResults`.
- `<link rel="preload" as="fetch" crossorigin href="/docs.json">` in `index.html`.
- `NodeDetail` bounded render (max ~26 nodes) replaces the previous "render entire parent subtree" approach.

Explicitly NOT done and intentionally deferred: virtualization, code-splitting markdown/KaTeX, worker docs.json dedup via postMessage, brotli/gzip at build.

### Styling

Pure CSS hover via `.scope-node.is-target` / `.scope-node.is-muted` classes — **no JS hover handlers**. Color tokens live as CSS variables in `src/index.css`:

- `--bg #160e0d` (charcoal w/ red undertone), `--surface`, `--hover #3a1f1a`
- `--red #a63228` (left bar on selected node), `--accent #c67267` (links/focus, browner-pinker — *not* the original error-looking red)
- `--tan #f3e7ce` / `--tan-2` / `--tan-3` (tans/browns)
- Fonts: Lora (serif body), Source Code Pro (mono)
- KaTeX is overridden to use `--tan` color

Selected-node treatment: red left bar, **transparent background** (no fill), brighter text. Sister nodes are muted (`opacity: 0.45`) and brighten on hover with `--hover` background. The user iterated several times on this — don't add backgrounds to the selected node.

## Conventions / preferences

- **Don't add hover/click logic in JS when CSS will do it.** The user explicitly removed the JS handlers and wants pure CSS state.
- **The home button is a plain HTML link** (`<a href="/">`), not an `onClick` handler.
- **Search quality > bundle size** for the lunr index. Full-content indexing is intentional.
- **Scroll-to is `behavior: "instant"`**, not smooth — the user found smooth scrolling sluggish.
- **Sticky header collisions**: any scroll target needs `scrollMarginTop: "64px"`.
- **Don't override git user.name/email.** Trust global config — never pass `-c user.name=... -c user.email=...`.
- **Show stats before touching the UI** when changing the build pipeline. The user wants to see counts/samples of what `build-index.mjs` produces before any visual change consumes it.

## Pending work

### Next pass: address identification (chainlog + Etherscan) — design approved, not yet implemented

Scope for the **labels-only** pass (the "wait" on viem/value reads is explicit — that's a separate pass later):

- **New: `scripts/build-addresses.mjs`**
  - Fetch Sky chainlog mainnet: `GET https://chainlog.skyeco.com/api/mainnet/active.json`. Shape is a flat map `{ "MCD_VAT": "0x35D1…", ... }` — ~400 entries, Ethereum mainnet only. Invert to `addr → chainlogId`.
  - For each unique address extracted from the atlas, call Etherscan **`getsourcecode`** (NOT `getabi` — same cost, returns `ContractName`, `ABI`, `Proxy` flag, `Implementation` in one call). Use `chainid=1` by default; only hit other chains if `detectChain()` signals a non-mainnet chain for that specific address.
  - Read-through disk cache at `.cache/etherscan/<chainid>/<addr>.json` — **committed to git** (user explicitly chose: contributors/CI don't need an API key to build; cache stays valid since contract metadata ~never changes).
  - Throttle: `await sleep(250)` between cache misses only. 4 req/s stays comfortably under the 5 req/s free-tier cap. Steady-state after the first full build ≈ 100% cache hits.
  - Requires `ETHERSCAN_API_KEY` env var. User will provide.
- **Emit `public/addresses.json`** — small, frontend-visible. Shape per address: `{ chain, label, chainlogId?, etherscanName?, isContract, isProxy, implementation?, roles, aliases, expectedTokens }`. **No ABIs, no source code** — those stay in `.cache/` for the next pass.
- **Strip `docs.json`** — remove the per-node `addresses` map. Each node keeps `addressRefs: string[]` instead. Frontend joins against the shared `addresses.json` at runtime. Breaking change is fine ("this is still a fresh project").
- **Label resolution priority** for the final `label` field: chainlogId > atlas-extracted entityLabel > etherscan ContractName > null. Distinct losers go into `aliases[]` (same pattern as the existing Curve/Morpho Integration Boost fix).
- **Frontend:**
  - New `src/lib/addresses.ts` — module-level `loadAddresses()` mirroring `loadDocs()`.
  - `NodeContent` rehype plugin resolves address links against the shared map instead of per-node data.
  - `AddressCard` reads from the shared map.
  - `loadAddresses()` fetched in parallel with `loadDocs()` (add a second preload link in `index.html`).

### Deferred: snapshot pass (view values + balances)

Explicitly NOT part of the labels pass. Designed as a static snapshot system, **not a backend**:

- Atlas-referenced on-chain state changes at most every ~2 weeks; balances maybe daily. No live RPC needed at the edge.
- **New: `scripts/fetch-snapshots.mjs`** — reads ABIs from `.cache/`, uses **viem + multicall3** to batch hundreds of view-function reads into ~10 RPC calls per run. Writes `public/chain-state.json` with `{ generatedAt, block, values: { [chain/addr]: { [method]: value } }, balances: { [chain/addr]: { [token]: amount } } }`.
- **No ABIs ever ship to the frontend.** All contract decoding happens at build time; the frontend only sees JSON-serialized results.
- Refresh via GitHub Actions cron (daily for balances, weekly for state). Every snapshot is a git commit → auditable, versioned, `git blame`-able drift detection.
- **Killer feature:** atlas/chain drift detection. Diff atlas-stated values against snapshot values at build time, surface warnings in the UI.
- Open questions still to resolve before building this pass:
  1. Cron ownership (GH Actions on this repo vs external)
  2. RPC endpoint preference (public llamarpc/cloudflare vs Alchemy/Infura if user has a key)
  3. Stale-value signalling (single global `generatedAt` vs per-address freshness)

### Other / background

- **Fix `0x` address search** — typing `0x` should auto-wildcard to return all address-bearing nodes. Still open.
- **Reduce `unknown` role share** — many addresses sit in markdown tables; table-row inference using column headers is partially done in `build-index.mjs` via `findTableContext` / `annotationText`, could be tuned further.
- **Research [pretext](https://github.com/chenglou/pretext)** — possible way to inline structured data into Atlas content.
- **Thematic views** — e.g. an "agent profile" view (Spark, etc.) that presents Atlas nodes as a richer domain object instead of raw markdown.

## File map

```
scripts/build-index.mjs           build pipeline; address extraction + classification + merge pass
scripts/build-addresses.mjs       NOT YET — chainlog + Etherscan getsourcecode + addresses.json
public/docs.json                  generated; per-node content + addresses map (addresses to be stripped in next pass)
public/search-index.json          generated; serialized lunr index
public/addresses.json             NOT YET — frontend address metadata (no ABIs)
.cache/etherscan/<chainid>/*.json NOT YET — committed cache of getsourcecode responses
src/App.tsx                       shell only; routing, layout, handlers
src/lib/docs.ts                   loadDocs() module cache
src/lib/addresses.ts              NOT YET — loadAddresses() module cache
src/components/NodeContent.tsx    markdown + KaTeX + rehypeEthAddresses; module-scope components + memo
src/components/NodeDetail.tsx     bounded context render (parent + 8 above + target + 8 children + 8 below)
src/components/ScopeNode.tsx      single context card; React.memo
src/components/RelatedNode.tsx    linked-node card; React.memo
src/components/AddressCard.tsx    address card with roles + aliases
src/components/SearchBar.tsx      header: home link, input, scope pills
src/components/SearchResults.tsx  result list + status line; useMemo on filtered hits
src/components/SearchHints.tsx    idle-state syntax hints
src/components/SearchResult.tsx   single result card; React.memo
src/workers/search.worker.ts      lunr query worker + phrase post-filter
src/hooks/useSearch.ts            debounced search hook
src/hooks/useScopes.ts            depth-1 scope loader (via loadDocs)
src/types.ts                      AtlasNode, SearchHit, AddressInfo, worker messages
src/index.css                     Tailwind import + CSS variables + KaTeX overrides
index.html                        title, fonts, favicon, preload docs.json
vite.config.ts                    base: '/redlens/'
vendor/next-gen-atlas/            git submodule — Atlas source
.github/workflows/                CI/CD
```
