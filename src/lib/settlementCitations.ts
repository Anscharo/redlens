// The Atlas documents that define the figures on a Prime's settlement
// ring. UUIDs are the keys (doc_nos change on renumbering; they sit in the
// comments for reading). A figure with no entry here — what the Prime
// keeps, per-venue revenue — is a workbook figure the Atlas defines no
// term for, and is drawn muted and unlinked.

export interface SettlementCitation {
  uuid: string;
  /** The Atlas document's own term for the figure. */
  term: string;
}

export const SETTLEMENT_CITATIONS = {
  // A.2.4.1.2.2.1.1.2
  toSky: { uuid: "e98ddd17-a8c3-4523-8464-cc41247c66e8", term: "Amount Due From Prime To Sky With Respect To Supply Side Primitives" },
  // A.2.4.1.2.2.1.1.1.3 — distribution rewards and the agent rate only
  fromSky: { uuid: "cef16014-05db-4b21-a5a2-20e62aaca027", term: "Amount Due From Sky To Primes With Respect To Distribution Reward And Agent Rate" },
  // A.2.4.1.2.1.3
  execVote: { uuid: "0d561ea6-8689-459c-85eb-7c861553e116", term: "Settlement Through Sky Core Executive Vote" },
  // A.2.4.1.2.2.1.1.2.2.1.1 — the per-instance charge at the Agent Credit
  // Line Borrow Rate; the workbook allocates the Prime's charge to venues
  cof: { uuid: "6cbe7181-419f-4a7b-a659-85972d5100a3", term: "Instance Expense" },
  // A.2.4.1.2.2.1.1.2.2.1 — the per-venue profit, floored at zero
  instanceProfit: { uuid: "9974c452-216b-45c0-8a1d-621816b8da2a", term: "Instance Profit" },
  // A.2.2.10.1.1.1.1.5
  sde: { uuid: "07e0f716-ce23-4394-a5f4-bee537713f48", term: "Revenue Sharing For Sky Direct Exposures" },
  // A.3.1.2.3
  agentRate: { uuid: "012c953b-c522-4ea3-939b-3282af4e1d7e", term: "Agent Rate" },
  // A.2.2.9.1
  distributionRewards: { uuid: "e632c38f-3e4e-4c7e-acfd-b6ec45a422e6", term: "Distribution Reward Primitive" },
  // A.2.3.1.2.1.1
  netRevenue: { uuid: "bddce7bf-c568-444b-b196-e15a99016696", term: "Net Revenue" },
  // A.2.2.11.1 — the workbook's governance_accessibility_rewards
  gar: { uuid: "b22d1c08-042a-4466-94fe-9d28951e4d4a", term: "Core Governance Reward Primitive" },
  // A.2.8.2.10.2.1.2 — what Sky pays Grove under the Sky–Grove Accord
  chroniclePoints: { uuid: "d4a5ce00-b041-4e9d-9bed-23253aba1b01", term: "Compensation Formula (Sky and Grove Accord)" },
} as const satisfies Record<string, SettlementCitation>;

export function citationFor(key: string): SettlementCitation | undefined {
  return (SETTLEMENT_CITATIONS as Record<string, SettlementCitation>)[key];
}
