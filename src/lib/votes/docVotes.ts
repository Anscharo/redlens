// The executive votes behind one atlas document, for the reader's "votes"
// panel: every executive that links the document by uuid, and every executive
// the Stale Dates matching (with the worker's refinements, ./overlay.ts) ties
// to one of its dated claims. One row per executive, newest first, each with
// why it is listed. Pure.
//
// Polls are left to the history list, which shows the poll that approved each
// edit (VoteIndex.approvals). An executive that cites a poll is not listed for
// every document that poll's pull request touched: a weekly Atlas Edit pull
// request touches hundreds of documents, and the executive acts on one item.

import type { AtlasNode } from "../../types";
import { extractDateClaims } from "../staleDates";
import { voteEvidence, type VoteEvidence } from "./evidence";
import { overlayClaim, type VoteEvidenceOverlay } from "./overlay";
import type { VoteIndex } from "./vote-index";

export type DocVoteReason =
  | { kind: "links" } // the executive links this document
  | { kind: "claim"; raw: string; evidence: VoteEvidence }; // matched to a dated claim in it

export interface DocVote {
  title: string;
  date: string;
  url: string;
  reasons: DocVoteReason[];
}

export function executivesForDoc(
  doc: AtlasNode,
  docs: Record<string, AtlasNode>,
  index: VoteIndex | null,
  overlay: VoteEvidenceOverlay | null,
  today: Date,
): DocVote[] {
  const rows = new Map<string, DocVote>();
  const add = (v: Omit<DocVote, "reasons">, reason: DocVoteReason) => {
    const row = rows.get(v.url) ?? { ...v, reasons: [] };
    row.reasons.push(reason);
    rows.set(v.url, row);
  };
  for (const l of index?.links.get(doc.id) ?? []) {
    if (l.kind === "executive") add({ title: l.executive.title, date: l.date, url: l.executive.url }, { kind: "links" });
  }
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (const claim of extractDateClaims(doc, todayUTC).claims) {
    const e = overlayClaim({ ...claim, voteEvidence: index ? voteEvidence(claim, docs, index) : undefined }, overlay).voteEvidence;
    if (e?.vote?.kind === "executive") add({ title: e.vote.title, date: e.vote.date, url: e.vote.url }, { kind: "claim", raw: claim.raw, evidence: e });
  }
  return [...rows.values()].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}
