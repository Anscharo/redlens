---
name: pau-triage
description: >
  Runbook for curating the PAU registry (src/data/pau-registry.json): which
  on-chain contracts make up each Prime agent's PAU (ALM controller, ALM proxy,
  rate limits, diamond AccessControls / AdministeredAgent / facets, relayers,
  freezers) per chain and controller generation. Triggered by phrases like
  "triage the PAU candidates", "update the PAU registry", "a prime deployed a
  new controller", "pau:candidates", "is the atlas controller still live", or
  any edit to src/data/pau-registry.json or scripts/lib/pau-*.ts.
license: MIT
metadata:
  author: anscharo
  version: "1.0"
---

# pau-triage

The PAU registry is the only input the PAU indexer reads: an address that is not in it is never indexed. It is curated by hand from three signals that `pnpm pau:candidates` gathers. You are the judgement step, the "LLM suggestion" lane of the design: read the evidence, decide, and record why.

## Model

- One **deployment** per (prime entity UUID, chain, `monolithic | diamond`). Spark on Arbitrum has two, because its diamond shares the ALM proxy with a ForeignController that stays in service.
- **Members** carry a role (`controller`, `almProxy`, `rateLimits`, `accessControls`, `administeredAgent`, `beacon`, `facet`, `freezer`, `relayer`) and provenance: `atlas` (with the doc UUID), `onchain` (what the contract itself says), `llm`, or `manual`, each with a `note`.
- **`shared`** holds the contracts every diamond on a chain uses (Beacon, the facet set from the Allocation System primitive's "Liquidity Layer Shared Contracts").
- **`ignored`** holds atlas claims you rejected, each with a reason, so the queue stops proposing them. A rejected atlas claim is still an atlas error, and the reason is what the UI will cite, so write it as a fact a reader can check ("RateLimits revoked its CONTROLLER role on 2025-12-01").
- Types and the validator: `src/lib/pauRegistry.ts`. Primes are keyed by entity UUID; `primeName` is for humans only.

## Run

```bash
pnpm build:index && pnpm build:graph       # if public/docs.json is missing or stale
pnpm pau:candidates --rpc                  # queue + wiring checks → .cache/pau-candidates.md
pnpm pau:candidates --rpc --draft          # also writes .cache/pau-registry.draft.json (registry + every missing observation)
```

`--rpc` reads public RPCs from the chain registry (`RPC_URL_<CHAIN>` overrides). The live-controller lookup reads RateLimits grant history from a block explorer: Etherscan v2 on every chain when `ETHERSCAN_API_KEY` is set, otherwise only chains with a registered Blockscout instance (Ethereum today). Without it, L2 deployments say "no grant history" rather than proposing a controller. Set the key when triaging L2s.

## Reading the report

1. **Registry errors**: fix first; nothing else is trustworthy until the file validates.
2. **Missing from the registry**: atlas observations the registry neither holds nor ignores. Each row cites the doc. Typical causes: a new chain or a new generation, or a role-hierarchy rename.
3. **Stale registry provenance**: a member's atlas doc is gone or no longer names its address. Check whether the atlas moved the address (re-point provenance) or retired it (remove the member, or keep it with `onchain` provenance if the chain says it is still live).
4. **Atlas conflicts**: the atlas disagrees with itself (one address under two roles or two primes) or with the explorer's verified contract name. These are atlas errors; they stay in the report until upstream fixes them, and the registry follows the chain.
5. **On-chain wiring**: failed checks, plus proposals the chain makes:
   - `live controller` fails when RateLimits does not grant CONTROLLER to the listed controller. The proposal names the account that does, and when it was granted. Spells rotate controllers without the atlas always following.
   - `proxy` / `rateLimits` / `accessControls` / `beacon` fail when the controller points elsewhere; the pointer comes back as a proposal.
   - Monolith `relayer` / `freezer` checks use `hasRole` on the controller. Diamond ones compare the AdministeredAgent's enumerated actors (relayers) and revokers (freezers) with the registry, both ways.
   - A diamond's `Controller.integrations()` lists every facet it dispatches to; a facet not in the deployment or the chain's shared set comes back as a proposal.

## Decide

For each item, prefer the chain over the atlas for *what is deployed*, and keep the atlas claim visible when they disagree:

- **Chain confirms the atlas**: accept the observation (copy it from the draft, keep its `atlas` provenance).
- **Chain contradicts the atlas**: put the chain's address in the registry with `onchain` provenance and a note naming the call; add the atlas claim to `ignored` with the reason.
- **Neither can be confirmed** (no explorer history, a contract that reverts, a chain with no RPC): keep the atlas claim and say so in the PR; the wiring check keeps flagging it.
- **Non-EVM** (Keel's Solana ALM program): out of scope for this registry; discovery skips non-0x addresses.

Then re-run `pnpm pau:candidates --rpc` until "missing" is zero and every remaining failed check is one you can explain in the PR body. Run `pnpm vitest run scripts_tests/pau-registry.test.ts`: it validates the file and checks every member's verified contract name (committed `.cache/etherscan/`) against its role.

## Seed decisions (atlas `33fd263`)

The first registry encoded these; re-check them when the atlas changes:

- Spark mainnet: the atlas controller `0x577fa18a…` lost CONTROLLER on 2025-12-01; the live one is `0x5c46fc65…`.
- Spark Avalanche: the atlas lists proxy and rate limits as TBD; the controller points at `0xece6b0e8…` and `0xb79972e8…`. Its listed controller is also not granted CONTROLLER (history needs an Etherscan key).
- Spark X Layer: the docs swap freezer and relayer; on-chain `0x90d8c80c…` is FREEZER and `0x8a25a24e…` is RELAYER.
- Grove Plume: the controller and rate-limits docs copy the Plasma proxy and the Base controller addresses.
- Spark Arbitrum diamond: the Beacon doc's second address is an L2GovernanceRelay.
- Grove Plasma: the controller holds no grants and the multisigs hold no roles; listed, not active.
