# PAU state: admin-event history and live snapshots

Reads what the chain says about every contract in `src/data/pau-registry.json` (curation: the `pau-triage` skill, discovery: `pnpm pau:candidates`). Nothing here reads the atlas; an address the registry does not list is never read.

## Pieces

- `admin-events.ts` is the catalogue of governance events per (generation, role): role grants, `RateLimitDataSet`, per-pool parameters, diamond integrations, AdministeredAgent membership, BeamState's registrations, defaults and step limits. Facet events are listed under the diamond Controller, because facets run by delegatecall and the Controller emits them. Operational events (relayer swaps, deposits, `RateLimitIncrease/DecreaseTriggered`) are left out on purpose: they are one per relayer action and say nothing about configuration.
- `sync-events.ts` fills `pau_events`. There is one `pau_cursor` per (chain, contract, event), because explorer log APIs filter on a single topic0 and that filter is what keeps the operational events out. A cursor at block 0 reads the contract's whole history, so backfill and catch-up are the same path. Each tick visits the least recently checked cursors until `PAU_EVENT_BUDGET_SECONDS` is spent. Reads stop `CONFIRMATIONS` blocks behind the head. A rate-limited explorer ends the tick for that chain only and leaves its cursor unmarked, so it is first in line next tick; any other error is written to `last_error` and the rotation moves on.
- `replay.ts` folds stored events into configuration: role holders (AccessControl is not enumerable, so the replay is the only list), AdministeredAgent members, every rate-limit key ever set, diamond integrations, the latest value per parameter and subject.
- `snapshot.ts` builds one deployment's `pau_state` row. It confirms each replayed holder with `hasRole` and reads every key with `getRateLimitData` / `getCurrentRateLimit`. A failed read is `null`, never `false`. Relayers and freezers have no events of their own; their roles show on the contracts that grant them.
- `beam.ts` reads what BeamState lets the Configurator (cBEAM) do to each RateLimits it manages without a spell. BeamState is a shared contract, one per chain (registry `shared`, role `beamState`; the `configurator` role is listed for provenance and polled for nothing). A RateLimits gets a `beam` block only when BeamState registers it (`rateLimits(rl)`, else the replayed `AddRateLimits`/`DelRateLimits`): `getHop` and `getMaxChange`, and every default ("init") limit in force. Defaults are read live with `initRateLimits(key, rl)` and `initRateLimits(key, 0)` for every key the RateLimits holds or the replay names; this RateLimits' own default wins when non-zero, else the general one applies, as `getInitRateLimits` does. So a default shows even where BeamState's history is unread (no explorer serves Arbitrum without `ETHERSCAN_API_KEY`), except for a key the RateLimits has never held. A failed read falls back to the replay.
- `units.ts` attaches the token each limit is counted in (`unit`), after derivation names the key. The rule per `LIMIT_*` constant comes from the controllers' source:
  - fixed units: USDS for a mint or farm, USDC for CCTP or a Superstate subscription, an 18-decimal normalized value for Curve and Uniswap;
  - the vault's `asset()` for an ERC-4626, ERC-7540, Maple or Spark Vault key;
  - the adapter's `token()` for LayerZero, else the token itself;
  - the token itself for Aave, PSM and asset-transfer keys.
  A key no rule covers, or one whose token's `decimals()` fails, has no `unit`, and readers fall back to `inferDecimals`.
- `store.ts` holds the refresh gate (every snapshot rebuilt once the oldest passes `PAU_REFRESH_SECONDS`, or when a deployment has none; snapshots of deployments the registry dropped are deleted) and `GET /api/pau`.
- `rpc-reader.ts` is the live reader (viem multicall per chain through `rpcFor`).
- `key-derive.ts` names rate-limit keys the atlas never writes out as a hash. A controller derives each key from a `LIMIT_*` constant (keccak256 of its name), alone or abi-encoded with an address, a CCTP domain or LayerZero endpoint id, or an (asset, destination) pair. The deriver hashes every zero-argument `LIMIT_*` view in the cached ABIs (`.cache/etherscan`, which `.dockerignore` keeps for the worker) against every address in the address artifacts and the registry, and the refresh stores the match as the key's `derived`. Shapes are hashed lazily, cheapest first; once any key is unnamed the full table costs about 15 seconds, paid only when snapshots rebuild. Names the atlas states (the prime's and its instances' RateLimitID params) still come first wherever a key is shown.

The worker step is `scripts/lib/worker-steps/pau.mjs`. It injects `explorerLogs` (`scripts/lib/explorer-logs.ts`), `rpcHead` and `rpcChainReader`, so everything above is tested with fakes.

## Why logs come from an explorer

Public RPCs cap `eth_getLogs` at about 10,000 blocks (Arbitrum's refuses even 1,000), far below a contract's lifetime. The explorer pages by result count instead.

`explorerLogs` tries the providers `explorerBases` lists, in order: Etherscan v2 (with `ETHERSCAN_API_KEY`), Routescan (registry `routescan: true`), then the chain's Blockscout (registry `blockscoutApi`). Every request asks for a 1,000-log page, because Routescan's default page is 100 and a short page reads as the end of the history. When Etherscan answers that the key's plan does not cover the chain, the fetcher moves to the next provider and skips Etherscan for that chain until the process ends. The worker is a cron process that exits after each run, so a change to `ETHERSCAN_API_KEY` takes effect on the next worker run. Any other error goes to `sync-events.ts` unchanged. A rate limit is not a refusal, so the cursor waits for the next tick and the fetcher does not try Routescan or Blockscout. Each API host has its own request clock (`throttleExplorer` in `scripts/lib/explorer-api.ts`): 1 request a second by default, or the registry's longer `blockscoutIntervalMs`. `BLOCKSCOUT_API_KEY` goes only to instances under `blockscout.com`, because another host rejects a key it did not issue. A chain with no provider records `no explorer serves <chain>`; a chain whose every provider refused records `every explorer refused <chain> (…)` with each refusal.

Where each chain's history comes from, on Etherscan's free plan:

| Chain | Source | Why not another |
|---|---|---|
| ethereum, arbitrum, unichain, plasma | Etherscan v2 | |
| robinhood | Etherscan v2 | Its Blockscout answers scripted requests with a Cloudflare challenge page (HTTP 403), with or without a User-Agent, an API key or `/api/v2`. |
| optimism | optimism.blockscout.com | Etherscan's free plan refuses chain 10. |
| avalanche | Routescan | Etherscan's free plan refuses chain 43114. |
| plume | its Blockscout | Etherscan v2 has no endpoint for chain 98866. |
| xlayer | XLayerScan (`api.xlayerscan.com`) | Etherscan v2, Routescan and api.blockscout.com do not serve chain 196. OKLink needs a key. XLayerScan allows one request every 5 seconds per IP, so its host waits 6 seconds between requests (registry `blockscoutIntervalMs`). |
| base | none | See below. |

**Base cannot be read without a paid or keyed source.** Etherscan v2: `Free API access is not supported for this chain. Please upgrade your api plan`. base.blockscout.com: a Cloudflare challenge page (HTTP 403). api.blockscout.com: `Featured chain 8453 requires one of the following plans: Builder, Business, Pro` (HTTP 402). Routescan: `chain not supported`. MultiBaas's free plan indexes only 100 blocks behind the head. Public RPCs: mainnet.base.org caps `eth_getLogs` at 500 blocks, drpc at 10,000, thirdweb at 1,000, nodies at 50, blastapi at 10, and publicnode refuses anything older than recent blocks (`Archive requests require a personal token`). The contracts are about 30 million blocks old, so a 10,000-block crawl is about 3,000 requests per cursor across 38 cursors. Any of a paid Etherscan plan, a Blockscout PRO plan or a keyed archive RPC would fix it.

## When to move off the worker step

The producer is a worker tick step because none of these hold. Moving to an indexer (Ponder, or a hosted one such as MultiBaas, Goldsky or Envio, behind the same `pau_*` tables) is justified once any one does:

1. Values must be fresher than about a minute.
2. Operational (relayer) events must be indexed, not only configuration.
3. State has to be rebuilt by replaying every event, not read live.
4. The step takes more than a couple of minutes per tick, or the backfill cannot converge within the budget.
