// The Atlas documents that define the figures on a Prime's settlement
// ring. UUIDs are the keys (doc_nos change on renumbering; they sit in the
// comments for reading). A figure with no entry here — what the Prime
// keeps, GAR, per-venue revenue — is a workbook figure the Atlas defines no
// term for, and is drawn muted and unlinked.

export interface SettlementCitation {
  uuid: string;
  /** The Atlas document's own term for the figure. */
  term: string;
}

export const SETTLEMENT_CITATIONS = {
  // A.2.4.1.2.2.1.1.2
  toSky: { uuid: "e98ddd17-a8c3-4523-8464-cc41247c66e8", term: "Amount Due From Prime To Sky With Respect To Supply Side Primitives" },
  // A.2.4.1.2.2.1.1.1
  fromSky: { uuid: "33d1b516-d347-4d44-9af6-95f25e8a8d8c", term: "Amount Due From Sky To Primes With Respect To Demand Side Primitives And Agent Rate" },
  // A.2.4.1.2.1.3
  execVote: { uuid: "0d561ea6-8689-459c-85eb-7c861553e116", term: "Settlement Through Sky Core Executive Vote" },
  // A.3.1.2.5 — cost of funds is the Agent Credit Line Borrow Rate's charge
  cof: { uuid: "6b2b7302-e63b-457e-afeb-daab5ca7a7de", term: "Agent Credit Line Borrow Rate" },
  // A.2.2.10.1.1.1.1.5
  sde: { uuid: "07e0f716-ce23-4394-a5f4-bee537713f48", term: "Revenue Sharing For Sky Direct Exposures" },
  // A.3.1.2.3
  agentRate: { uuid: "012c953b-c522-4ea3-939b-3282af4e1d7e", term: "Agent Rate" },
  // A.2.2.9.1
  distributionRewards: { uuid: "e632c38f-3e4e-4c7e-acfd-b6ec45a422e6", term: "Distribution Reward Primitive" },
  // A.2.8.2.10.2.1.1
  chroniclePoints: { uuid: "a7ccb2d1-970e-4b91-a430-4173ade00396", term: "Chronicle Point Reward Instance" },
} as const satisfies Record<string, SettlementCitation>;

export function citationFor(key: string): SettlementCitation | undefined {
  return (SETTLEMENT_CITATIONS as Record<string, SettlementCitation>)[key];
}
