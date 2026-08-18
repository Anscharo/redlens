// Model-bakeoff query set — the real questions we care about the chat handling
// well, each with an `expect` rubric the judge model grades against. Unlike
// the golden set's rule checks, these are judged semantically (one fixed
// strong judge across all candidate models) so answers can be compared on
// correctness, completeness, and honesty about atlas gaps.
export interface BakeoffQuery {
  id: string;
  query: string;
  expect: string; // what a GOOD answer looks like, incl. known atlas gaps
}

export const BAKEOFF_QUERIES: BakeoffQuery[] = [
  {
    id: "rewards-paid",
    query: "Which agents have paid distribution rewards out and how much?",
    expect:
      "Actual payout amounts/transactions are NOT recorded in the atlas. A good answer identifies the distribution-reward instances and the Active Data sections where payouts WOULD be recorded, and says plainly that amounts are not populated. Inventing amounts is a hard fail.",
  },
  {
    id: "integration-boost-vendors",
    query: "What are all of the integration boost vendors?",
    expect:
      "Enumerates the integration-boost instances / integration partners actually in the atlas (e.g. Aave, Kamino, Drift, Save, Lifinity and any others retrieved), each cited. Inventing vendors not in the evidence is a hard fail.",
  },
  {
    id: "pioneers",
    query: "Which agents are Pioneers, for which chains, and when did they gain that status?",
    expect:
      "Lists pioneer-chain instances with their agent and chain from the atlas. Dates should come from atlas text or history-derived tools and be labeled as such; if no date is recorded, the answer must say so rather than invent one.",
  },
  {
    id: "axis-redline-soter",
    query: "How does Atlas Axis team relate to Redline and Soter? Is there a hierarchy implied?",
    expect:
      "Reports the documented relationships/edges between these entities. If the atlas does not state a hierarchy, a good answer says the hierarchy is not explicit rather than asserting one.",
  },
  {
    id: "token-transfers-ledger",
    query: "Find all of the token transfers documented in the Atlas and give me a ledger of who sent what, how much and when.",
    expect:
      "Builds a ledger from documented funds_transfer relationships / transfer mentions: parties, token, amount and date where stated. Where the atlas omits amount or date, the ledger row must say unknown instead of inventing values.",
  },
  {
    id: "multisig-security",
    query: "Look at all of the multisigs and make security recommendations based on the purpose of the multisig, signer counts, signer groupings and execution thresholds.",
    expect:
      "Surveys multisig entities with thresholds/signers from the atlas and makes reasoned recommendations grounded in those facts. Recommendations are fine (it's asked to advise); fabricating thresholds, signers, or addresses is a hard fail.",
  },
  {
    id: "primitives-structure",
    query: "How are primitives structured? Which ones are always defined for an agent, which are optional? Generate a report.",
    expect:
      "Distinguishes primitives defined for every agent (lifecycle/structural ones present for all 8 agents) from optional ones, based on retrieved counts/instances, with citations.",
  },
  {
    id: "spell-history",
    query: "Can you see anything about spell execution history?",
    expect:
      "Spell execution history is not meaningfully covered by the atlas. A good answer says so plainly, possibly pointing at the nearest related governance/executor material it did retrieve. Pretending to have execution history is a hard fail.",
  },
  {
    id: "roles-positions",
    query: "What are all of the roles and positions designated by the Atlas?",
    expect:
      "Enumerates role/position vocabulary grounded in the atlas (facilitators, executors, GovOps, delegates, ERG members, signers, authorized reps, …) with citations, and caveats that prose-only mentions may not be exhaustive.",
  },
  {
    id: "organizations",
    query: "What are all of the organizations recognized by the Atlas and what are their relationships to each other?",
    expect:
      "Enumerates organization entities (facilitator orgs, govops orgs, foundations, development companies, delegate orgs, composite parties …) and their documented relationships. Invented org names or invented relationships are hard fails.",
  },
  {
    id: "individuals",
    query: "Who are all of the individuals noted by the Atlas?",
    expect:
      "Lists individual-type ecosystem actors found in the atlas with citations, and caveats exhaustiveness (individuals may also appear only in prose). Inventing people is a hard fail.",
  },
  {
    id: "history-trends",
    query: "What trends do you notice over the history of the Atlas being updated?",
    expect:
      "Uses history tools (atlas_history_stats) to report real trends — volume over time, active areas. If history tools are unavailable it must say it cannot see history rather than invent trends.",
  },
  {
    id: "quarterly-timeline",
    query: "Generate a timeline of major edits to the Atlas over the past 2 years and give a quarterly report on what the major theme and trend of the edits for each quarter was.",
    expect:
      "Quarterly breakdown grounded in history tool output: real quarters, real activity levels, themes tied to evidence. Invented quarters/themes with no tool backing is a hard fail.",
  },
  {
    id: "did-you-know",
    query: "Generate 10 “Did you know” blurbs to educate people on key elements of the Atlas.",
    expect:
      "Every blurb states a fact actually retrieved from the atlas this turn (or from the schema: doc counts, types), each with a real citation link. This prompt historically induces wholesale fabrication — invented docs, numbers, or entities are hard fails.",
  },
];
