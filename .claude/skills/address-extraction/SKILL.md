---
name: address-extraction
description: >
  Knowledge base for on-chain address detection, chain attribution, and
  address classification in RedLens. Use when modifying address-chains.mjs,
  address-annotate.mjs, NodeContent.tsx / NodeContentInner.tsx, or any code
  that reads from addresses.atlas.json / addresses.json. Covers the EVM/Solana
  regex patterns, the load-bearing hex-boundary lookarounds, the three-pass
  chain detection algorithm, the ROLE_VOCAB classification system, and the
  sync constraint between the build pipeline and the frontend renderer.
  Keywords: address-chains, address-annotate, NodeContent, EVM regex, 0x regex,
  chain detection, detectChain, ROLE_VOCAB, entityLabel, expectedTokens,
  addresses.atlas.json, addresses.json, rehypeEthAddresses
license: MIT
metadata:
  author: anscharo
  version: "1.0"
---

# address-extraction

**Files this skill covers:**

- `scripts/lib/address-chains.mjs` — EVM/Solana regexes, `detectChain`, table-context detection
- `scripts/lib/address-annotate.mjs` — `ROLE_VOCAB`, `entityLabel`, `expectedTokens` (called from `build-graph` Phase 2.6)
- `src/components/NodeContent.tsx` / `NodeContentInner.tsx` — `rehypeEthAddresses` plugin that linkifies addresses in rendered markdown

**Sync constraint:** `address-chains.mjs` and `NodeContent.tsx` use the same EVM regex. If you change one, change both.

---

## Regex patterns

- **EVM:** `/(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g`
- **Solana:** `/\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g` (base58, 43–44 chars — assumed Solana by pattern alone)

### Load-bearing hex-boundary lookarounds

The negative lookarounds on the EVM pattern (`(?<![0-9a-fA-F])` before and `(?![0-9a-fA-F])` after) are **not optional**. Without them, the regex matches the leading 40 hex chars of any longer hex blob:

- Transaction hashes (64 hex)
- `bytes32` constants
- Role IDs / domain separators
- Raw calldata

This ships phantom addresses into `addresses.json` that don't correspond to real contracts. Both the build pipeline and the frontend renderer must use the exact same boundary form.

### 64-hex values are never linked

`0x` + 64 hex chars (tx hashes, `bytes32` values, role IDs, domain separators) are **not linked** even though they start with `0x`. These are are visually identical to each other and cannot be reliably distinguished from context.
 
---

## Chain detection

`detectChainOrNull(content, matchIndex)` reads the prose around an address and returns `null` when nothing names a chain; `detectChain` is the same thing defaulting to `ethereum`. Priority — first match wins:

1. **Explicit clause** — `on <phrase> is` immediately before the address (the last such clause, tolerating the `:` / backtick the atlas writes before the literal). Most reliable: the author stated the chain outright. Deliberately *not* anchored on `address on …` — atlas prose reads "The address of the `<long entity name>` on `<Chain>` is:", and requiring `address` adjacent to `on` matched almost nothing, so the entity name's own chain word won instead ("Grove **Arbitrum** … receiver on **Robinhood Chain**" → arbitrum).
2. **Tight-window keyword scan** — chain keywords in the 120 chars before.
3. **Wide-window keyword scan** — chain keywords in the 300 chars before.

Each keyword window is scanned **from the last address literal in it onward** first, falling back to the whole window when that segment names no chain. A chain named before some *other* address belongs to that address — without this, every row of a per-chain list (`- Ethereum Mainnet - 0x… - Arbitrum - 0x…`) inherited the first row's chain. The fallback means trimming can only add a signal, never remove the only one.

An enumeration (`on the Ethereum Mainnet, Base, and Arbitrum is` — one address deployed to all three) resolves by `CHAIN_HINTS` registry order, which puts ethereum first.

### Chain from a heading (`chainFromLabel`)

Atomized docs routinely put the chain in a **heading** and never repeat it in the one-line body — either inline (`ALM Proxy (Optimism) Contract`) or as a bare per-chain grouping heading (`Monolithic ALM Contracts` > `Robinhood Chain` > `ALM Proxy Contract`). `build-index` therefore falls back to the node's own title, then its **doc_no** ancestors' titles (`titleChainFor`). It walks doc_no rather than `parentId` because heading depth is capped at 6, which collapses the parent chain exactly in the deeply nested artifact subtrees where this pattern lives.

A title is a **label**, not prose, so `chainFromLabel` checks specific chains before ethereum — otherwise `Base Mainnet - …` resolves to ethereum on the `\bmainnet\b` hint. It keeps word-boundary matching (unlike `normalizeChainLabel`'s substring test) because a doc title is free text where "Database" must not read as base. A deferred chain (`FUTURE_TO_ETHEREUM`) resolves to ethereum rather than null, so the ancestor walk stops at the heading that named it.

### Cross-doc merge and precedence

`build-index` keeps the **first detected** chain per address; a defaulted ethereum (nothing named a chain) stays replaceable, a detected one does not. The older "anything beats ethereum" rule could not tell the two apart, so an address the atlas placed on `(Mainnet)` outright was re-pointed by any later doc that merely filed it under another chain's heading.

Overall precedence, strongest first:

1. **ICD-stated chain** — `build-graph` Phase 4.5a, from a `Token Address (<Chain>)` param key or a `Network` / `Integration Partner Chain` param. Structured data about this exact address. `icdParamChain` returns `null` (not `ethereum`) when the ICD names nothing, so an unlabelled ICD can't reset a chain detected from prose.
2. **Prose** — `detectChainOrNull`.
3. **Heading** — `chainFromLabel` over the doc's own title, then doc_no ancestors.
4. **Default** — `ethereum`.

`build-graph` Phase 2.6 deliberately does **not** recompute chain: it can't see headings, and its "prefer any non-ethereum detection" aggregation let a single stray mention win globally (a doc whose prose said "Gnosis **Protocol**" pinned the address to Gnosis **Chain**).

### Multi-chain addresses

Safes and the deterministically-deployed ALM contracts sit at the same address on several chains, and the storage layer was built for it: `atlas_addresses`' PK is `(address, chain)`, balances are keyed `address|chain`, and `has_address` edges are `${addr}:${chain}`.

So `addresses.atlas.json` carries **both**:

- `chain` — the single primary (first detected, else ethereum). Every existing consumer reads this and is unaffected.
- `chains` — every chain the atlas names for the address; always contains `chain`.

`buildAddrRows` emits **one DB row per entry in `chains`**. Writing only the primary was what hid multi-chain deployments from the DB and from the balances refresh.

Two things follow from one address having several rows:

- `is_contract` comes from `addresses.json`'s `codeByChain[chain]` (written by `applyOnchainCode`, which checks every chain in `chains`), falling back to the primary-chain `isContract`. An address can hold code on one chain and be an EOA on another — a single value stamped onto every row would be wrong.
- `chain_state` attaches only to the chain it was snapshotted on (`ChainStateEntry.chain`). The legacy flat `chain-state.json` shape has no chain, so it carries `chain: null` and still joins.

`atlas-updater`'s DB→artifact rebuild regroups those rows back into one entry per address, restoring `chains` — dropping it there would silently re-collapse what build-index detected.

**Supported chains and their block explorers:**

| Chain     | Explorer                    |
|-----------|-----------------------------|
| ethereum  | etherscan.io                |
| base      | basescan.org                |
| arbitrum  | arbiscan.io                 |
| optimism  | optimistic.etherscan.io     |
| polygon   | polygonscan.com             |
| avalanche | snowtrace.io                |
| gnosis    | gnosisscan.io               |
| solana    | solscan.io                  |

---

## Address classification

Runs in `build-graph` Phase 2.6 (via `address-annotate.mjs`). Each address gets three annotation fields written into `public/addresses.atlas.json`:

- **`roles: string[]`** — flat multi-tag array from the closed vocabulary `ROLE_VOCAB`. Multiple roles per address are supported.
- **`entityLabel: string`** — best-effort proper-noun phrase extracted from the 200 chars before the address in the atlas text.
- **`expectedTokens: string[]`** — token symbols (e.g. `USDS`, `SKY`, `MKR`) mentioned within ±300 chars of the address.

`ROLE_VOCAB` is the authoritative closed list of role tags. Add new roles there, not ad hoc in call sites.

---

## Address artifact split

Two separate artifacts — never mix their fields:

| Artifact | Owner | Fields |
|---|---|---|
| `public/addresses.atlas.json` | `build-index` (initial), `build-graph` Phase 4.5 (enrichment) | `chain`, `explorerUrl`, `roles`, `entityLabel`, `aliases`, `expectedTokens` |
| `public/addresses.json` | `build-addresses` | `chain`, `chainlogId?`, `etherscanName?`, `isContract`, `isProxy`, `implementation?` |

**`isContract` is the `eth_getCode` answer**, not "the explorer verified it". `address-enrich` sets a provisional value from `Boolean(etherscanName)`, then `build-addresses` overwrites every EVM entry via `address-code.mjs` (`applyOnchainCode`, public RPC from `CHAIN_RPC`, no API key). Verified source is strictly narrower than having code, so the provisional value alone reads every deployed-but-unverified contract as an EOA.

Two things that pass through `address-code.mjs` are load-bearing:

- A failed RPC call is signalled as `{ ok: false }`, never as an undefined code — viem's `getCode` resolves to `undefined` for an address with *no* bytecode, so the two are otherwise indistinguishable and a network blip would downgrade real contracts to EOAs.
- Chains with no `rpcUrl` (solana) are skipped entirely and keep the explorer's value. Solana addresses are consequently still hardcoded `isContract: false` in `address-enrich`, so they classify as "EOA" in the On-Chain Addresses report — a known wart, not a checked fact.

`build-addresses` must never write atlas annotation fields into `addresses.json`.

The frontend `loadAddresses()` loads both in parallel, merges per-address, and resolves `label = chainlogId ?? entityLabel ?? etherscanName`.
