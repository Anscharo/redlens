---
name: address-extraction
description: >
  Knowledge base for on-chain address detection, chain attribution, and
  address classification in SAbR. Use when modifying address-chains.mjs,
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

### Ambiguous docs are settled on-chain, not by guessing

When the prose and the heading name **different** chains, the doc is genuinely ambiguous — `A.6.1.1.2.2.6.1.2.1.1.1.1.4.2` is titled "Grove **Arbitrum** Governance Relay Receiver" and bodied "on **Robinhood Chain**". Picking one in `build-index` is a coin flip either way, so both become candidates in `chains` (prose first, as the provisional primary) and `build-addresses` settles it against the chains themselves:

- `applyOnchainCode` probes **every** candidate with `eth_getCode` **and** `eth_getTransactionCount`. An address is *present* on a chain if it has bytecode, or is an EOA that has sent at least one transaction. A zero nonce with no code is no evidence — an unused address is identical on every EVM chain.
- `resolvePresentChains` then keeps the candidates that came back present. One → that's the chain. Several → the address really is on several, and all are kept. None → the atlas's own answer stands.
- The atlas primary wins ties, so a reading the chain confirms is never reshuffled. When the primary turns out to be unsupported, `isContract` moves with the resolved chain.

`presentOnChains` (in `addresses.json`, primary first) therefore outranks `chains` in `buildAddrRows`. If the probe never ran — no `ETHERSCAN_API_KEY`, or an unreachable RPC — the field is absent and every candidate still gets a row, which degrades to "possibly one row too many" rather than to a wrong single answer.

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

### Adding a chain

```bash
pnpm chains:add <name>        # resolve from the public registry and write the entry
pnpm chains:add <name> --dry-run   # see what it would write
```

**`src/data/chain-registry.json` is the single source of truth.** All four structures derive from it — `CHAINS` + `FUTURE_TO_ETHEREUM` (`scripts/lib/chains.mjs`), `CHAIN_HINTS` (`scripts/lib/address-chains.mjs`), `EXPLORER` (`src/lib/explorer.ts`), `NATIVE_TOKEN` (`src/lib/tokens.ts`). Never hand-maintain any of them; edit the registry (or let `chains:add` edit it) and they follow.

They used to be four hand-kept lists, and **every omission failed silently**:

| Registry field | Silent failure if omitted |
|---|---|
| `chainId`, `rpcUrl` | label normalization collapses the chain to ethereum; no on-chain queries |
| `proseHints` | `detectChain` can *never* attribute prose to it — its addresses inherit whichever chain a neighbouring line names |
| `explorer` | addresses link to etherscan.io, pointing at another chain's explorer |
| `nativeToken` | `fetch-balances` skips the chain as unsupported — no balances at all |

`chains:add` resolves a chain from ethereum-lists/chains (the dataset behind chainid.network, read from its gh-pages mirror because chainid.network is not reachable everywhere), verifies the chainId with an `eth_chainId` round-trip, and refuses to write a half-entry when the source lists no explorer or no key-free RPC. **It is deliberately not part of `pnpm build`** — the build is offline and deterministic (`REPRO=1` asserts two builds at one atlas SHA are byte-identical), so the fetch happens here and the result is committed as data.

A chain the atlas names but that is not live yet goes in the registry's `deferred` list instead: it collapses to ethereum deliberately and is bucketed `deferred` rather than `unknown` by the census.

Run `pnpm census:chains` after any registry edit — its completeness pass names any hole you left, and those warnings are never baselined (an incomplete entry is a code bug, not atlas drift). `pnpm census:chains --rpc` additionally round-trips every registry `rpcUrl` against its declared `chainId`.

### Catching a chain the atlas added

`census:chains` is the alarm for a chain the registry has never heard of, in three independent halves — see the docblock in `scripts/required/check-chains-census.mjs`. The one worth knowing about is the third: the label and prose halves both need the chain's name to appear in a shape they recognize, and a **single-word chain name in a plain bullet row** (`- Unichain - \`0x…\``) fits neither. `scripts/lib/chain-candidates.mjs` covers that case by reasoning about the list instead of the name — in an address list whose siblings name two or more distinct known chains, a row naming none is a candidate. That needs no advance knowledge of the missing chain's name, which is the only way a drift detector can actually detect drift.

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
| `public/addresses.json` | `build-addresses` | `chain`, `chainlogId?`, `etherscanName?`, `isContract`, `isProxy`, `implementation?`, and for Solana `accountType`, `programOwner?`, `programOwnerName?` |

**`isContract` is the `eth_getCode` answer**, not "the explorer verified it". `address-enrich` sets a provisional value from `Boolean(etherscanName)`, then `build-addresses` overwrites every EVM entry via `address-code.mjs` (`applyOnchainCode`, public RPC from `CHAIN_RPC`, no API key). Verified source is strictly narrower than having code, so the provisional value alone reads every deployed-but-unverified contract as an EOA.

Two things that pass through `address-code.mjs` are load-bearing:

- A failed RPC call is signalled as `{ ok: false }`, never as an undefined code — viem's `getCode` resolves to `undefined` for an address with *no* bytecode, so the two are otherwise indistinguishable and a network blip would downgrade real contracts to EOAs.
- Chains with no `rpcUrl` are skipped entirely and keep the explorer's value. Solana has no `rpcUrl` by design (see below) and is handled by its own pass.

### Solana — `scripts/lib/solana-accounts.mjs`

`eth_getCode` has no Solana equivalent, and the contract/EOA split does not describe Solana at all: every address is an *account*, and what it is comes from `getAccountInfo`'s `executable` flag plus its `owner` — the program allowed to write to it. Reading them through the EVM question mislabelled all 40 of the atlas's Solana addresses as EOAs, the ALM Controller program included.

`applySolanaAccounts` (called from `build-addresses` right after `applyOnchainCode`) sets:

| `accountType` | condition |
|---|---|
| `program` | `executable` — `isContract: true`; `isProxy` when owned by the BPF Upgradeable Loader, with the ProgramData account as `implementation` |
| `wallet` | System-Program-owned **and on-curve** — a real keypair, the only true EOA analogue |
| `pda` | System-Program-owned but **off-curve**, so no private key can exist for it: a program-derived vault (a Squads vault is one). 10 of the atlas's 13 System-owned addresses are these — only 3 are really keypairs — and calling them EOAs was the original mislabel |
| `mint` / `token-account` / `token-multisig` | owner is SPL Token or Token-2022; classic sizes are 82 / 165 / 355, and Token-2022 accounts longer than 165 carry an AccountType byte at offset 165 |
| `program-account` | any other owner — a PDA (controller state, relayer permission configs) |
| `missing` | the RPC answered `null` — the atlas names an address Solana has never seen |

Conventions worth keeping:

- **The RPC lives in `solanaRpcUrl`, not `rpcUrl`.** Solana's JSON-RPC is a different protocol, and every EVM pass keys off `rpcUrl`. `census:chains` asserts that a non-EVM chain declares no `rpcUrl`.
- **One `getMultipleAccounts` call per 10 keys, with a 166-byte `dataSlice`** — enough for the upgradeable-loader pointer (bytes 4..36) and the Token-2022 discriminator (byte 165), never enough to pull down an ELF. Sizes come from `space`, which is the *account's* length, not the slice's. The batch is 10 because PublicNode refuses 11+ with an HTTP 403 carrying JSON-RPC `-32602 "blocked parameter: params.0.#"` (measured; Solana's own cap is 100). Raise it only against an endpoint you've re-measured.
- **A rejected request's reason lives in the JSON-RPC body even on a 4xx**, so the body is parsed before the status is checked — reporting a bare "HTTP 403" makes an endpoint's parameter limit look identical to an egress-policy denial.
- **A failed batch omits its pubkeys from the result map**, the same discipline as `{ ok: false }` above: "the RPC is down" and "this account does not exist" are otherwise indistinguishable, and conflating them would rewrite every Solana row on a blip.
- `PROGRAM_NAMES` holds only fixed runtime program ids. Anything else is named from the atlas's own `entityLabel` for that pubkey when it has one (so a PDA reads "owned by Solana ALM Controller Program"), else shown raw — a wrong friendly name is worse than none.

The report's `classifyAddress` reads `accountType` ahead of the EVM fallthrough, mapping it to the `Program` / `Program Account` / `Token` / `EOA` buckets. An atlas `multisig` / `token` role still outranks it.

### Solana balances — `src/server/balances/solana-balances.ts`

SOL plus the SPL mints in `SOLANA_TOKENS` (`src/lib/tokens.ts`), returned in the same `BalanceResult` shape as the EVM path. USDS lands in the report's existing USDS column; SOL, USDT and USDC fall into "Other Balances" simply by not being in `PRIMARY_BALANCE_SYMBOLS`.

- **Token accounts are derived, not looked up.** `getTokenAccountsByOwner` and `getTokenLargestAccounts` are indexed scans PublicNode does not serve — measured, they hang. An associated token account's address is a pure function of (owner, token program, mint), so `scripts/lib/solana-pda.mjs` derives it (base58 + ed25519 curve membership + `findProgramAddress`) and `getMultipleAccounts` reads it like any other account.
- **`tokenProgram` is a derivation seed**, so a Token-2022 mint's account sits at a different address than a classic SPL one's. Getting it wrong yields a plausible address that simply never exists — silently zero, not an error.
- **A derived account is only credited once its own data agrees on owner *and* mint.** The derivation is deterministic, so a mismatch means the assumption is wrong, and crediting a balance to the wrong address is the one failure here that is invisible in the report.
- **An address can itself be a token account** (the atlas documents the ALM Controller's USDC one). Its balance is on the account, not on anything derived from it — hence the `self.owner !== address` branch.
- `NATIVE_TOKEN` stays EVM-only: it gates the multicall path, and putting SOL in it would route Solana addresses through viem. `SOLANA_NATIVE` is separate for that reason.

`build-addresses` must never write atlas annotation fields into `addresses.json`.

The frontend `loadAddresses()` loads both in parallel, merges per-address, and resolves `label = chainlogId ?? entityLabel ?? etherscanName`.
