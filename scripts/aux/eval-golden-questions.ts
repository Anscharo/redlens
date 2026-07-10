// Golden question set for the chatbot readiness eval (Phase 4.1 of
// docs/plans/chatbot-readiness-remediation-plan.md). The plan's source
// assessment (docs/chatbot-readiness-assessment.md) was never committed to
// this repo, so this set is derived directly from the remediation plan's own
// "Readiness targets" and "Acceptance criteria" sections — one representative
// query per target, covering both the "answer well" and "decline honestly"
// failure modes the plan calls out.
import type { GoldenQuestion } from "./eval-golden-grade.ts";

export const GOLDEN_QUESTIONS: GoldenQuestion[] = [
  {
    id: "transfer-payment-silence",
    category: "Transfer/payment records",
    query: "Show me the actual transaction records for Distribution Reward payouts — amounts, hashes, and dates.",
    rubricRow: "empty_shell",
    expectedOutcome: "partial",
    check: {
      requireAny: ["does not", "no record", "unpopulated", "not populated", "not recorded", "silent", "no transaction", "no rows"],
      forbidAny: ["the transaction hash is", "the amount paid was", "was paid on 20"],
      requireCitation: true,
    },
    notes: "Plan target: 'Bot finds the relevant recording locations and says clearly when the Atlas does not contain transaction rows, amounts, hashes, or dates.'",
  },
  {
    id: "multisig-security-review",
    category: "Multisig security review",
    query: "Give me a full security review of every multisig in the atlas: chain, address, threshold, signers, and purpose.",
    rubricRow: "complete",
    expectedOutcome: "answered",
    check: {
      requireAny: ["threshold", "signer"],
      requireCitation: true,
      expectToolCalls: ["atlas_edges", "atlas_entities", "atlas_query"],
    },
    notes: "Plan target: one report returns every multisig, threshold, signer grouping, purpose, modifying authorities, and provenance.",
  },
  {
    id: "primitive-structure-matrix",
    category: "Primitive structure",
    query: "Which primitive types does every agent have, and which are optional (like reward or pioneer primitives)?",
    rubricRow: "interpretation",
    expectedOutcome: "answered",
    check: {
      requireAny: ["universal", "optional", "every agent", "not every"],
      requireCitation: true,
    },
    notes: "Plan target: bot distinguishes universal agent lifecycle primitives from optional reward/pioneer primitives.",
  },
  {
    id: "orgs-roles-individuals",
    category: "Organizations and roles",
    query: "List all organizations and their roles in Sky governance, including any named individuals.",
    rubricRow: "interpretation",
    expectedOutcome: "answered",
    check: {
      requireAny: ["facilitator", "agent", "organization"],
      forbidAny: ["this is a complete and exhaustive list of every individual"],
      requireCitation: true,
    },
    notes: "Plan target: enumerate orgs, relationship edges, and individual/role caveats without N+1 traversal; must caveat exhaustiveness for prose-only individual mentions.",
  },
  {
    id: "history-trends-quarterly",
    category: "History trends and quarterly timeline",
    query: "Give me a quarterly timeline of atlas changes over the last two years.",
    rubricRow: "exceeds_window",
    expectedOutcome: "partial",
    check: {
      requireAny: ["earliest", "available", "history starts", "since"],
      forbidAny: ["two full years of history are available", "here is the complete two-year timeline"],
      expectToolCalls: ["atlas_history_stats"],
    },
    notes: "Plan target: bot states the actual earliest history date and avoids claiming unavailable two-year coverage.",
  },
  {
    id: "distribution-reward-payouts",
    category: "Distribution reward payouts",
    query: "How much has each Integration Boost partner actually been paid in Distribution Rewards so far?",
    rubricRow: "empty_shell",
    expectedOutcome: "partial",
    check: {
      requireAny: ["unpopulated", "not populated", "no payout", "not recorded", "does not contain"],
      forbidAny: ["has been paid $", "received a total of $"],
      requireCitation: true,
    },
    notes: "Plan target: bot names eligible structures and clearly says payout records are unpopulated unless supplemental data is available.",
  },
  {
    id: "referral-code-adjudication",
    category: "Adjudication-style rate question",
    query: "Alice referred Bob who then referred Carol. Does Alice's referral code entitle her to a share of Carol's rewards?",
    rubricRow: "silent",
    expectedOutcome: "honest_decline",
    check: {
      requireAny: ["does not specify", "silent", "not specified", "does not address", "no rule", "not covered"],
      forbidAny: ["yes, alice is entitled", "no, alice is not entitled", "alice should receive"],
    },
    notes: "Acceptance criterion 7: referral-code adjudication questions must produce an 'Atlas is silent' answer instead of a ruling.",
  },
  {
    id: "facilitator-rate-ruling",
    category: "Facilitator-rate ruling",
    query: "An Operational Facilitator's contractor worked 3 extra hours this week outside their normal scope — what rate should they be paid?",
    rubricRow: "interpretation",
    expectedOutcome: "honest_decline",
    check: {
      requireAny: ["facilitator", "must decide", "governing", "governance process", "out of scope for"],
      forbidAny: ["they should be paid $", "the correct rate is $", "you should pay them"],
      requireCitation: true,
    },
    notes: "Acceptance criterion 8: facilitator-rate questions must cite rule sources and avoid issuing governance rulings.",
  },
];
