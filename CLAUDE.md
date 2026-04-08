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
- EVM: `/0x[0-9a-fA-F]{40}/g`
- Solana: `/\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g` (base58, 43–44 chars — assumed Solana by pattern alone)

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

- **`src/workers/search.worker.ts`** — loads docs.json + search-index.json, runs lunr queries, generates highlighted snippets via match positions, returns all results (no slice). Falls back to wildcard query on bad lunr syntax.
- **`src/hooks/useSearch.ts`** — debounced wrapper with a pending-id race guard.
- **`src/hooks/useScopes.ts`** — loads depth-1 nodes, cached at module level.
- **`src/components/NodeContent.tsx`** — markdown rendering. Custom dark-themed components for `p`, `ul`, `ol`, `code`, `table`, `blockquote`, `hr`. Custom `rehypeEthAddresses` plugin walks text nodes (skipping any inside existing `<a>` tags), splits at addresses, wraps them in `<a>` to the explorer URL from the pre-built address map. UUID hrefs are intercepted and routed via `onNavigate` for SPA navigation.
- **`src/components/SearchResult.tsx`** — title on its own line; type badge, doc_no, uuid below.
- **`src/App.tsx`** — main app. Two-panel responsive layout `lg:grid-cols-[3fr_2fr]` (60/40 main/annotations split). Search bar with home button (plain `<a href="/">` — *not* a JS handler) and home icon. Scope pills (depth-1 nodes) for filtering. `nodeId` is React state synced via `pushState` + `popstate` listener. When viewing a node, walks `parentId` once for context (not the entire scope) and renders `doc_no.*` siblings around the target. Annotations panel only shows nodes that are *explicitly* linked via UUID-bearing markdown links in the target's content.

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

1. **Wire address classification into the annotations panel** — currently the data exists in `docs.json` but the UI doesn't display `role`/`entityLabel`/`contextTokens`. Goal: show token balances (via viem) for addresses that have `contextTokens`.
2. **Fix `0x` address search** — typing `0x` should auto-wildcard to return all address-bearing nodes.
3. **Reduce `unknown` role share (381/549)** — many addresses sit in markdown tables; consider table-row inference using nearby column headers.
4. **Research [pretext](https://github.com/chenglou/pretext)** — possible way to inline structured data into Atlas content.
5. **Thematic views** — e.g. an "agent profile" view (Spark, etc.) that presents Atlas nodes as a richer domain object instead of raw markdown.

## File map

```
scripts/build-index.mjs      build pipeline; address extraction + classification
public/docs.json             generated; per-node content + addresses map
public/search-index.json     generated; serialized lunr index
src/App.tsx                  main app; routing, layout, ScopeNode, NodeDetail
src/components/NodeContent.tsx   markdown + KaTeX + rehypeEthAddresses
src/components/SearchResult.tsx  result card
src/workers/search.worker.ts     lunr query worker
src/hooks/useSearch.ts           debounced search hook
src/hooks/useScopes.ts           depth-1 scope loader
src/types.ts                     AtlasNode, SearchHit, worker messages
src/index.css                    Tailwind import + CSS variables + KaTeX overrides
index.html                       title, fonts, favicon
vendor/next-gen-atlas/           git submodule — Atlas source
```
