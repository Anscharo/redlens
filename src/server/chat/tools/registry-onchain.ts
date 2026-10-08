// On-chain state tools: what the chain holds, read and stored by the atlas
// worker (src/server/onchain/). New sources plug in there, not here.
import { z } from "zod";
import { onchainState, type OnchainQuery } from "../../onchain/query.ts";
import { readOnlyAtlasTool, type AtlasTool } from "./tool-types.ts";

export const ONCHAIN_TOOLS: AtlasTool[] = [
  {
    name: "atlas_onchain",
    whenToUse:
      "The question is about what is set ON-CHAIN now — live or current rate limits, deposit/withdrawal/mint limits, how much is available, who holds a controller role, what a spell changed — for one agent or across all of them. Use this instead of reading an RPC or inferring from atlas text; the atlas says what should be set, this says what is.",
    annotations: readOnlyAtlasTool("On-chain State"),
    description:
      "Values read from the chain and stored by the atlas worker — today every Prime Agent PAU controller: each rate limit's " +
      "maximum, refill per day and available amount (raw and scaled), each role holder (with whether hasRole confirms it) and " +
      "AdministeredAgent member, and the transaction that last set each. Each fact names its entity, chain and contract, its " +
      "name (`name_source`: `atlas` when an atlas RateLimitID param names the key, `derived` when the controller constant " +
      "that hashes to it does, null when neither), and `set_at.url` to cite. `coverage` says per deployment when it was read " +
      "and whether its history is complete; where it is not, a missing fact is not proof of absence. Switched-off limits " +
      "(maximum 0) are left out unless `include_off`. Returns `{ sources, coverage, count, truncated?, facts }`.",
    shape: {
      entity: z.string().optional().describe("Entity slug or name (e.g. 'osero', 'Grove'). Omit to search every entity."),
      chain: z.string().optional().describe("Chain (e.g. 'ethereum', 'base', 'arbitrum')."),
      kind: z.enum(["rate-limit", "role", "member"]).optional().describe("Fact kind."),
      address: z.string().optional().describe("Only facts about this address: a PAU contract, a role holder, or an asset a key is derived from."),
      query: z.string().optional().describe("Words every fact must contain, matched against its name, constant and values (e.g. 'deposit', 'USDS mint', 'RELAYER')."),
      include_off: z.boolean().optional().describe("Include switched-off rate limits (maximum 0)."),
      limit: z.number().int().min(1).max(200).default(50),
    },
    emptyArgsAbsent: true,
    handler: (ix, a) => onchainState(ix, a as unknown as OnchainQuery),
  },
];
