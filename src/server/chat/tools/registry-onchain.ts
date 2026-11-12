// On-chain state tools: what the chain holds, read and stored by the atlas
// worker (src/server/onchain/). New sources plug in there, not here.
import { z } from "zod";
import { PAU_CHANGES_NOTE, PAU_CLASSES, PAU_LAYOUT } from "../../../lib/pauLayout.ts";
import { pauChanges, type PauChangeQuery } from "../../onchain/pau-changes.ts";
import { onchainState, type OnchainQuery } from "../../onchain/query.ts";
import { readOnlyAtlasTool, type AtlasTool } from "./tool-types.ts";

export const ONCHAIN_TOOLS: AtlasTool[] = [
  {
    name: "atlas_onchain",
    whenToUse:
      "The question is about what is set ON-CHAIN now — live or current rate limits, default/init rate limits, deposit/withdrawal/mint limits, how much is available, who holds a controller role, a max slippage or exchange rate — for one agent or across all of them, or whether an atlas number matches the contract. Use this instead of reading an RPC or inferring from atlas text; the atlas says what should be set, this says what is. Which spell changed a value is atlas_liquidity_changes, not this tool.",
    annotations: readOnlyAtlasTool("On-chain State"),
    description:
      "Values read from the chain and stored by the atlas worker — today every Prime Liquidity Layer controller, a monolithic ALM Controller or a Diamond PAU: each rate limit's " +
      "maximum, refill per day and available amount (raw, and scaled by the decimals `decimals_source` names: `token` read from the " +
      "token, `constant` fixed by the controller constant, `inferred` from the limit's size), each role holder (with whether hasRole " +
      "confirms it) and AdministeredAgent member (with whether the AdministeredAgent lists it now), and the transaction that last set each. Where BeamState manages a RateLimits, a " +
      "`beam-state` fact says how far the Configurator may move its limits without a spell (hop, max change, the rule), and each " +
      "`rate-limit-default` fact is a default (\"init\") rate limit it may set a key up to; none listed means none is set for any key the RateLimits holds. Each " +
      "`atlas-vs-contract` fact is one maxAmount or slope an instance states in the atlas beside what its contract holds " +
      "(`values.agrees`). A `parameter` fact is a live setting the page lists (max slippage, max exchange rate, a recipient); a guard no switched-on rate limit lets act is left out. " +
      "Each fact has `relation`: " + PAU_CLASSES.replaceAll("\n", " ") + " " +
      "Filter with `relation`. Each fact names its entity, chain and contract, its " +
      "name (`name_source`: `atlas` when an atlas RateLimitID param names the key, `atlas-address` when the atlas lists an " +
      "address there instead and this key is derived from it — one address can feed several keys, so say so — `derived` when " +
      "the controller constant that hashes to it does, null when none), and `set_at.url` to cite. `coverage` says per deployment when it was read " +
      "and whether its history is complete; where it is not, a missing fact is not proof of absence. Switched-off limits " +
      "(maximum 0) are left out unless `include_off`. Returns `{ sources, coverage, count, truncated?, facts }`.",
    shape: {
      entity: z.string().optional().describe("Entity slug or name (e.g. 'osero', 'Grove'). Omit to search every entity."),
      chain: z.string().optional().describe("Chain (e.g. 'ethereum', 'base', 'arbitrum')."),
      kind: z.enum(["rate-limit", "rate-limit-default", "beam-state", "atlas-vs-contract", "role", "member", "parameter"]).optional().describe("Fact kind."),
      relation: z.enum(["mirrors", "differs", "pointed", "chain-only"]).optional().describe("mirrors: the atlas number equals the contract. differs: it does not, or the key is not set. pointed: the atlas names it and the live reading is only here. chain-only: a rate limit the atlas does not name."),
      address: z.string().optional().describe("Only facts about this address: a liquidity-layer contract, a role holder, or an asset a key is derived from."),
      query: z.string().optional().describe("Words every fact must contain, matched against its name, constant and values (e.g. 'deposit', 'USDS mint', 'RELAYER')."),
      include_off: z.boolean().optional().describe("Include switched-off rate limits (maximum 0)."),
      limit: z.number().int().min(1).max(200).default(50),
    },
    emptyArgsAbsent: true,
    handler: (ix, a) => onchainState(ix, a as unknown as OnchainQuery),
  },
  {
    name: "atlas_liquidity_changes",
    whenToUse:
      "The question is about which spell, operator, or other transaction changed a Prime's Liquidity Layer — a rate limit, a role, a parameter — or what is queued and not yet run. Also the question of how those contracts relate (relayer, controller, ALM proxy, rate limits, freezer, admin). PAU names only the Diamond design.",
    annotations: readOnlyAtlasTool("Liquidity Layer Changes"),
    description:
      PAU_LAYOUT + "\n\n" + PAU_CHANGES_NOTE + "\n\n" +
      "One row per transaction, newest first: chain, time, tx url, origin (kind, spell, evidence), the executive title when the vote record or the archive has one, and each change (event, contract, subject, args, before). " +
      "`queued` is the steps scheduled and not yet run. Filter with entity, chain, origin, spell and query. Returns `{ note, count, truncated?, queued, changes }`.",
    shape: {
      entity: z.string().optional().describe("Entity slug or name (e.g. 'osero', 'Grove'). Omit to search every prime."),
      chain: z.string().optional().describe("Chain (e.g. 'ethereum', 'base')."),
      origin: z.enum(["spell", "relayed", "operator", "deployment", "direct", "unknown"]).optional().describe("Who made the change, as the chain proves it."),
      spell: z.string().optional().describe("Only changes from this spell address."),
      query: z.string().optional().describe("Words every row must contain, matched against the executive title, the event and the evidence."),
      limit: z.number().int().min(1).max(80).default(20),
    },
    emptyArgsAbsent: true,
    handler: (ix, a) => pauChanges(ix, a as unknown as PauChangeQuery),
  },
];
