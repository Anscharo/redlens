# PAU state: admin-event history and live snapshots

Reads what the chain says about every contract in `src/data/pau-registry.json` (curation: the `pau-triage` skill, discovery: `pnpm pau:candidates`). Nothing here reads the atlas; an address the registry does not list is never read.

## Pieces

- `admin-events.ts` is the catalogue of governance events per (generation, role): role grants, `RateLimitDataSet`, per-pool parameters, diamond integrations, AdministeredAgent membership. Facet events are listed under the diamond Controller, because facets run by delegatecall and the Controller emits them. Operational events (relayer swaps, deposits, `RateLimitIncrease/DecreaseTriggered`) are left out on purpose: they are one per relayer action and say nothing about configuration.
- `sync-events.ts` fills `pau_events`. There is one `pau_cursor` per (chain, contract, event), because explorer log APIs filter on a single topic0 and that filter is what keeps the operational events out. A cursor at block 0 reads the contract's whole history, so backfill and catch-up are the same path. Each tick visits the least recently checked cursors until `PAU_EVENT_BUDGET_SECONDS` is spent. Reads stop `CONFIRMATIONS` blocks behind the head. A rate-limited explorer ends the tick for that chain only and leaves its cursor unmarked, so it is first in line next tick; any other error is written to `last_error` and the rotation moves on.
- `replay.ts` folds stored events into configuration: role holders (AccessControl is not enumerable, so the replay is the only list), AdministeredAgent members, every rate-limit key ever set, diamond integrations, the latest value per parameter and subject.
- `snapshot.ts` builds one deployment's `pau_state` row. It confirms each replayed holder with `hasRole` and reads every key with `getRateLimitData` / `getCurrentRateLimit`. A failed read is `null`, never `false`. Relayers and freezers have no events of their own; their roles show on the contracts that grant them.
- `store.ts` holds the refresh gate (every snapshot rebuilt once the oldest passes `PAU_REFRESH_SECONDS`, or when a deployment has none; snapshots of deployments the registry dropped are deleted) and `GET /api/pau`.
- `rpc-reader.ts` is the live reader (viem multicall per chain through `rpcFor`).
- `key-derive.ts` names rate-limit keys the atlas never writes out as a hash. A controller derives each key from a `LIMIT_*` constant (keccak256 of its name), alone or abi-encoded with an address, a CCTP domain or LayerZero endpoint id, or an (asset, destination) pair. The deriver hashes every zero-argument `LIMIT_*` view in the cached ABIs (`.cache/etherscan`, which `.dockerignore` keeps for the worker) against every address in the address artifacts and the registry, and the refresh stores the match as the key's `derived`. Shapes are hashed lazily, cheapest first; once any key is unnamed the full table costs about 15 seconds, paid only when snapshots rebuild. Names the atlas states (the prime's and its instances' RateLimitID params) still come first wherever a key is shown.

The worker step is `scripts/lib/worker-steps/pau.mjs`. It injects `explorerLogs` (`scripts/lib/explorer-logs.ts`: Etherscan v2 with `ETHERSCAN_API_KEY`, else the chain's Blockscout), `rpcHead` and `rpcChainReader`, so everything above is tested with fakes.

## Why logs come from an explorer

Public RPCs cap `eth_getLogs` at about 10,000 blocks (Arbitrum's refuses even 1,000), far below a contract's lifetime. The explorer pages by result count instead. Without `ETHERSCAN_API_KEY` only chains with a registered Blockscout are served; the rest record `no explorer serves <chain>` on their cursors and their snapshots show `events: 0`.

## When to move off the worker step

The producer is a worker tick step because none of these hold. Moving to an indexer (Ponder, or a hosted one such as MultiBaas, Goldsky or Envio, behind the same `pau_*` tables) is justified once any one does:

1. Values must be fresher than about a minute.
2. Operational (relayer) events must be indexed, not only configuration.
3. State has to be rebuilt by replaying every event, not read live.
4. The step takes more than a couple of minutes per tick, or the backfill cannot converge within the budget.
