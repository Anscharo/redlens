// Extended query set (2026-07-15) — 8 questions covering atlas areas the core
// + rulings + golden sets miss: scope structure, facilitator lifecycle,
// per-agent addresses, document-type semantics, agent lifecycle, status
// changes, cross-agent comparison, and role-group membership. Doubles as
// verifier/advisor corpus feedstock: clean judged answers are promoted into
// .cache/eval-evidence/ by eval-corpus-from-bakeoff.ts.
import type { BakeoffQuery } from "./eval-bakeoff-queries.ts";

export const EXTENDED_QUERIES: BakeoffQuery[] = [
  {
    id: "ext-scopes-overview",
    query: "What Scopes does the Atlas define, and what does each one govern? Name one key responsibility per Scope.",
    expect:
      "Enumerates exactly the Scope articles actually retrieved (e.g. Governance, Support, Protocol, Stability, Accessibility) with a governed area and one responsibility each, every scope cited. Inventing a scope or a responsibility not in the evidence is a hard fail.",
  },
  {
    id: "ext-facilitator-lifecycle",
    query: "How are Operational Facilitators appointed and removed? What happens if a facilitator becomes unresponsive?",
    expect:
      "Grounds appointment/removal in the facilitator framework documents retrieved, with citations. Where the atlas does not specify a step (e.g. unresponsiveness handling), the answer must say the atlas is silent rather than invent a procedure.",
  },
  {
    id: "ext-agent-addresses",
    query: "What on-chain addresses does the Atlas document for Spark, and what role does each address play?",
    expect:
      "Lists only addresses present in retrieved atlas content with their documented roles/labels, each cited. Any address string not present verbatim in the evidence is a hard fail (addresses cannot be paraphrased).",
  },
  {
    id: "ext-active-data-vs-spec",
    query: "What is the difference between an Active Data document and a Type Specification document in the Atlas? How does Active Data get updated?",
    expect:
      "Explains both document types from the atlas's own structural/definition docs with citations, and describes the documented update path for Active Data. If the update process is not documented, says so plainly.",
  },
  {
    id: "ext-agent-lifecycle",
    query: "What lifecycle stages does a Prime Agent go through according to the Atlas, from launch to potential wind-down?",
    expect:
      "Reports the lifecycle/status stages actually defined in retrieved primitives (e.g. launch, active operation, suspension, completion/wind-down) with citations, using the atlas's own status vocabulary. Inventing stages or transition rules is a hard fail.",
  },
  {
    id: "ext-status-changes",
    query: "Which entities recognized by the Atlas have been derecognized, renamed, or had a major status change — and when?",
    expect:
      "Uses status edges / history tools for real transitions (e.g. renames like Launch Agent → named agent, derecognitions) with dates only where the tools attest them. Undated or unsupported transitions must be labeled as such; invented dates or entities are hard fails.",
  },
  {
    id: "ext-compare-spark-grove",
    query: "Compare Spark and Grove as Prime Agents: which primitives, reward structures, and governance obligations do they share, and where do they differ?",
    expect:
      "A parallel comparison grounded in each agent's retrieved primitive instances and reward docs, citing both sides. Differences must come from the evidence; asserting an asymmetry the evidence doesn't show is a hard fail.",
  },
  {
    id: "ext-erg-membership",
    query: "What is the Ecosystem Research Group (ERG)? Who are its members and what powers or duties does the Atlas give them?",
    expect:
      "Defines the group from retrieved atlas text with citations, lists members only if the atlas names them, and states duties/powers as documented. If membership or powers are not enumerated in the atlas, the answer says so instead of inventing them.",
  },
];
