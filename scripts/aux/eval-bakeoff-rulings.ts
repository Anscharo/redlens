// Facilitator-ruling query set — real interpretation questions raised by a
// Soter rep (2026-07), each pending a facilitator ruling. These stress the
// STRONG position: multi-doc rate/scope reasoning where the atlas is partially
// silent. Each `expect` embeds the reviewer's reasonably-true reference
// position; the judge grades grounding + reasoning against it, not verbatim
// agreement. Universal hard fails: inventing an explicit atlas rule/rate, or
// issuing the answer AS a facilitator ruling instead of flagging that the
// final call is the facilitator's.
import type { BakeoffQuery } from "./eval-bakeoff-queries.ts";

export const RULING_QUERIES: BakeoffQuery[] = [
  {
    id: "ruling-referral-codes",
    query:
      "Are some referral codes restricted to specific contracts? In particular regarding Distribution Reward support of Spark Savings Vaults V1 vs Spark Savings Vaults V2.",
    expect:
      "Reference position (reviewer): referral/reward codes should NOT be restricted to a set of contracts. A good answer retrieves what the atlas actually says about reward-code assignment and scope, states whether any contract-level restriction is documented (reviewer believes none is), and flags that a facilitator ruling is the final word. Hard fail: asserting a restriction (or its absence) as explicit atlas text without evidence.",
  },
  {
    id: "ruling-arbitrum-refcode-0",
    query:
      "Should Distribution Rewards for sUSDS on Arbitrum be counted for Skybase, given the referral code used is 0?",
    expect:
      "Reference position (reviewer): no — referralCode 0 is the default value of a mandatory function parameter, not Skybase's assigned code, so attribution to Skybase is unsafe. A good answer retrieves how the atlas ties Distribution Rewards to reward codes / agent attribution, notes whether Skybase has a documented code, and surfaces the ambiguity of code 0 rather than ruling. Hard fail: inventing a documented code assignment or claiming the atlas settles this.",
  },
  {
    id: "ruling-farms-dr-eligibility",
    query:
      "Are the Chronicle/Sky Farms (USDS → SKY, USDS → SPK and USDS → CLE) eligible for Distribution Rewards?",
    expect:
      "Reference position (reviewer): yes — rewards paid in another token are not double-counting, and the farms drive USDS demand; but the atlas could be clearer. A good answer retrieves the Distribution Reward eligibility and double-counting language, applies it to the farms, and is explicit about where the atlas is ambiguous. Hard fail: citing a nonexistent double-counting rule or fabricating farm coverage.",
  },
  {
    id: "ruling-keel-bridge-dr",
    query:
      "Should Keel get Distribution Rewards on all USDS supply of the Ethereum <> Solana bridge? Does that conflict with Pioneer Rewards?",
    expect:
      "Reference position (reviewer): unsettled — the Distribution Reward and Pioneer Reward primitives appear to overlap/conflict here. A good answer retrieves both primitives, lays out each one's scope over bridged USDS, states that the atlas does not resolve the overlap (if retrieval confirms that), and defers the call to a facilitator ruling. Hard fail: asserting a conflict-resolution rule the atlas doesn't contain.",
  },
  {
    id: "ruling-stusds-rate",
    query: "What Distribution Reward rate should be used for stUSDS in every month of 2026?",
    expect:
      "Reference position (reviewer): 10bps (0.1%) total for all of 2026 — no 30bps boost, because the stUSDS rate is set at 0.1% total and the boosted rate is scoped to USDS and sUSDS only (stUSDS lives in a different primitive). A good answer retrieves the stUSDS rate doc and the boost-scope docs and reproduces that reasoning with citations. Hard fail: inventing a rate or extending the boost to stUSDS without atlas text.",
  },
  {
    id: "ruling-susdc-rate",
    query: "What Distribution Reward rate should be used for sUSDC in every month of 2026?",
    expect:
      "Reference position (reviewer): 50bps, because the sUSDC contract directly holds sUSDS (had the sUSDS been held by the Prime Agent itself, only 20bps would apply). A good answer retrieves the rate tiers (boosted vs held-by-agent basic rate), identifies which applies to a contract directly holding sUSDS, and cites the rate docs. Hard fail: fabricating rate tiers or holder distinctions not in the atlas.",
  },
  {
    id: "ruling-ib-partner-usds-rate",
    query:
      "What Distribution Reward rate applies for USDS balances held by an Integration Partner that already receives Integration Boost — e.g. DR received by Spark for USDS held by Aave?",
    expect:
      "Reference position (reviewer): the boosted 50bps rate applies — it is the standard rate for USDS held by a DeFi protocol, vs the 20bps basic rate for USDS held by the Prime Agent itself; receiving Integration Boost does not change that. A good answer retrieves the rate structure and the Integration Boost primitive, checks whether any anti-stacking rule exists, and says plainly if the atlas is silent on the interaction. Hard fail: inventing an anti-stacking or rate-override rule.",
  },
  {
    id: "ruling-farms-dr-rate",
    query: "If the Chronicle/Sky farms are eligible for Distribution Rewards, which DR rate applies to them?",
    expect:
      "Reference position (reviewer): the boosted 50bps rate, because the farms hold/rely on the USDS token (not a Prime-Agent-held balance). A good answer retrieves the boosted-vs-basic rate scope and applies it to token-holding farm contracts, citing the rate docs, while noting eligibility itself is a separate open question. Hard fail: fabricating a farm-specific rate.",
  },
];
