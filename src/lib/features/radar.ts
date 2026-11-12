import type { FeatureGroup } from "../features-types.ts";

export const radar: FeatureGroup = {
    key: "radar",
    title: "Radar",
    route: "/radar",
    blurb: "Dashboards for every party in the Sky ecosystem — Agents, Facilitators, Alignment Conservers, and more.",
    features: [
      {
        name: "Radar search",
        what: "Find actors, primitive instances, parameter values, addresses and relationships from one box.",
        how: ["Type in the search box on Radar. Each result opens the matching part of the actor page — for a Prime Agent's instance or parameter, its Primitives page."],
      },
      {
        name: "Actor dashboards",
        what: "A full profile per party: responsibilities, primitives, relationships, rewards, invoked instances, on-chain state, contact, and its own change history.",
        how: [
          "Open Radar and pick an actor from the list.",
          "Scan the dashboard sections; the composite party view ties an Agent's associated legal entities together as one party.",
          "A Prime Agent's row in the list opens into its pages instead: Info (the profile), Settlements, History, Primitives and Liquidity Layer Arch. (PAUs). Click a Prime's name to open or close its pages; the Prime you open a page of opens by itself and stays open until you close it, and no other Prime opens or closes on its own.",
        ],
        note: "Settlements is listed only for Primes with a Monthly Settlement Cycle workbook, and Liquidity Layer Arch. (PAUs) only once the atlas worker has read that Prime's controller contracts.",
      },
      {
        name: "Primitive dashboards & activation matrix",
        what: "See primitives and which actors have activated them.",
        how: ["From Radar, open a primitive to view its dashboard and activation matrix."],
      },
      {
        name: "Instance cards checked against the chain",
        what: "On a Prime Agent's Primitives page, instance cards check what they state against the chain. An Agent Creation card checks that its SubProxy Account is the admin of the Prime's controller contracts (or is named by the Prime's StarGuard) and its StarGuard Max Delay against the StarGuard; an Agent Token card checks its token address, name, symbol and Genesis Supply against the token on Ethereum (a supply can differ after burns or emissions). An allocation card checks every maxAmount and slope against the value the chain holds, every RateLimitID against the keys the RateLimits holds, every listed address against the rate limits and parameters that use it, and the Underlying Asset Address against what the chain records the token wraps (a vault's asset, an aToken's underlying, a Curve pool's coins), a vault's owner, curator, allocator and sentinel role addresses against the vault, and its max slippage, max exchange rate and Configurator default limits against the guards the controller holds. Red is kept for where the Atlas is probably behind: a red circled ! where the Atlas leaves a RateLimitID or a value to be specified while the chain holds one switched on (the tooltip shows the likely keys or the value on chain). ✓ agrees, an amber ✗ differs (either side may be wrong), a grey clock differs only because the other side has not caught up yet: the spell the Atlas change's pull request names, or the open Atlas pull request recording a spell that changed the chain first, a grey ! the Atlas states a key the contract never set, ? cannot be checked (hover a mark for half a second for the tooltip, which says why), and – the Atlas has not stated it and the chain holds nothing switched on either. Every parameter also links to the Atlas document that states it.",
        how: [
          "Open a Prime Agent on Radar and pick `Primitives` under its name in the actor list.",
          "Hover a mark to see what the chain holds: a limit's value (and the Atlas value beside it on a ✗) with when it was set, linked to its transaction; an ID's key and its live limit; the rate limits and parameters that use an address and its token symbol; the asset a token wraps; or, on a red circled !, each likely key or the on-chain value the Atlas could state. Click the mark to open the document's Onchain tab.",
          "Hover a parameter row to highlight it and show the link (chain) icon after its name; click anywhere on the row to open the document stating that parameter (an address, a link or a mark in the row keeps its own click).",
        ],
        note: "Marks appear only for Primes whose controller contracts the atlas worker has read.",
      },
      {
        name: "Monthly settlement charts",
        what: "On primes that publish a Monthly Settlement Cycle workbook, the actor page shows last month's take; a full cycle page charts Sky's share, supply kept, and demand-side, plus the demand-side mix and venue AUM.",
        how: [
          "Open a Prime Agent on Radar (Spark, Grove, Obex, …).",
          "The Monthly settlement card in the top right shows the latest cycle; the `full cycle` link under the figure opens the charts, as does `Settlements` under the Prime's name in the actor list.",
          "On that page, Sky Forum opens the forum post for the month selected in the charts.",
          "Ask Chat or an MCP client about a month's To Sky / supply kept / demand-side — it will say those figures are not from the Atlas.",
          "On the cycle page, click a month in the Summary bars. Primes with several venues have a PnL / AUM toggle.",
          "In the venue flow chart, hover a flow, a venue name, or its row in the table below — that venue lights up in both, and its figures appear on the flows.",
          "A sink with loss-making venues gets two bars: what came in (`$X gross in`) and, in red just below it, what went back out (`−$Y out`), with the `net` the pair settles to underneath. A longer red bar than green means the month went backwards.",
        ],
        note: "Hidden when settlements.json has not been built (`pnpm settlements:parse`). Figures are Soter Labs OEA calculations, not the on-chain GovOps spell. Chat and MCP can answer the same views — they always say the numbers are not from the Atlas.",
      },
      {
        name: "PAU on-chain",
        what: "On a Prime Agent's Liquidity Layer Arch. (PAUs) page, which says it is part of the Prime's Allocation System Primitive, each controller deployment (per chain, a monolithic ALM Controller or a Diamond PAU, or both on one chain, or the Solana ALM Controller, whose limits are read from its Reserve and Integration accounts and whose roles are its Permissions, a suspended one shown as not held, each contract's role linking to the Atlas document that states it (hover the role for why the contract is listed: the Atlas, or the on-chain evidence where no Atlas document states it, and for a controller whether the chain's role grants confirm it), and a `not wired` or `partly wired` pill when the controller lacks the CONTROLLER role on its ALM proxy or rate limits) as the chain reports it: on a Diamond PAU the facets its controller uses (each with the Atlas's highest production rate limit for that facet, a design maximum shown for reference and not compared), who holds which role, every rate limit with its maxAmount and slope (refill per day) in its token's units (under `Matches Atlas`, a ✓ where every value the Atlas states for that limit matches the chain, a ✗ where one differs, a grey clock where it differs only because the other side has not caught up yet (the spell the Atlas change names, or the open Atlas pull request recording a spell), a ? where it cannot be told, or where the Atlas states the value only for another deployment and says which, each linking to the Atlas document stating the value, and a ⚑ where no document is connected to a limit a spell set, or a cBEAM set more than two months ago, and a limit named only by its controller constant shows `named in <document>` where exactly one document in that Prime's artifact names the constant on that chain), the latest parameters (each pool, market or vault named by its token symbol, a max slippage read as the most a swap or deposit may lose, a max exchange rate as assets per share, and a max slippage or exchange rate shown only while a rate limit for that address is above zero), on a diamond controller what its Configurator may change without a spell, and a `Change history` of every configuration change, grouped under the Executive Vote whose spell made it.",
        how: [
          "Open a Prime Agent on Radar and pick `Liquidity Layer Arch. (PAUs)` under its name in the actor list; click a chain's row to open or close it. `Change history`, below the chains, lists each change newest first with the value it replaced, grouped by Executive Vote across every chain the spell reached; a spell older than the vote record shows its address, and operator changes through the Configurator (with what BeamState allowed) and `Deployment` setup start collapsed. Under each Executive Vote the list of its changes starts collapsed behind a line counting them (`14 changes in 1 tx`); click it to open the list, and a chip that jumps to a change opens it for you. A key under the heading says what each kind of group means, and changes not yet credited to anything are folded by chain under `Not yet attributed`, each line saying what it is still waiting on. Every chain, section and history group has its own link: click the `#` to its left to copy it (the `#` turns to ✓), or write one by hand, such as `#ethereum`, `#ethereum-rate-limits`, `#facets`, `#roles`, `#parameters`, `#change-history` or `#exec-vote-2026-08-27`. A bare section name opens the first chain that has it, and a link opens any collapsed card or group it points into.",
          "A rate limit is named after the Prime Agent or instance whose parameters state its ID; a key the Atlas never states is named by the controller constant that derives it (such as `LIMIT_4626_DEPOSIT` and the vault), and `no document or controller constant found referencing this limit` marks one neither can name. Where an instance lists an address instead of a RateLimitID, the key derived from that address is named after the instance, marked `(matched by address)`, and the instance card shows it under the address as `on-chain key …`; when one address derives several keys, each name adds its controller constant. A limit derived from an address the Atlas no longer lists says `dropped from the Atlas` and the date, and one that is also switched off is left out of the table (the rate-limit count's tooltip says how many). Click a column header (`Name`, `maxAmount`, `Slope`, `Matches Atlas`, `Last updated`) to sort the table by it, and click it again to reverse; under `Matches Atlas`, ✗ sorts first, then ⚑, then ? and the clock, then ✓.",
          "In Roles, ✓ means the chain confirms the role or the AdministeredAgent membership, ✗ means the history says granted or added but the chain says no, ? means the check could not be read. A member the AdministeredAgent lists that the stored history lacks says `not in the stored history`.",
          "The date in the `Last updated` column opens the transaction that last set that limit, and the chip beside it names where the value came from (a spell, a spell relayed to Solana through LayerZero governance, an operator, a deployment) and jumps to its `Change history` row. Hover an amount to see where its decimals came from: read from the token, fixed by the controller, or inferred from the limit's size. `Configurator limits` says how far the Configurator may raise a limit without a spell (a factor, once per waiting period per key) and lists any default limits it may raise a key to.",
        ],
        note: "Appears once the atlas worker has read the controller contracts; a deployment whose history is still being read says `history still being read`. Chat on this page, and MCP clients, can ask for the same rate limits, parameters and spells (`redline_onchain`, `redline_liquidity_changes`), including where a number matches the Atlas, where it differs, and the live readings the Atlas names but does not hold.",
      },
    ],
  };
