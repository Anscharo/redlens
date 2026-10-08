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
  /** The cast spell's address, when the executive's spell has been cast. */
  spell?: string;
  title: string;
  date: string;
  url: string;
  reasons: DocVoteReason[];
}

type Rows = Map<string, DocVote>;

export function executivesForDoc(
  doc: AtlasNode,
  docs: Record<string, AtlasNode>,
  index: VoteIndex | null,
  overlay: VoteEvidenceOverlay | null,
  today: Date,
): DocVote[] {
  const rows: Rows = new Map();
  addLinking(rows, doc, index);
  addClaimed(rows, doc, docs, index, overlay, today);
  return [...rows.values()].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

function add(rows: Rows, v: Omit<DocVote, "reasons">, reason: DocVoteReason): void {
  const row = rows.get(v.url) ?? { ...v, reasons: [] };
  row.reasons.push(reason);
  rows.set(v.url, row);
}

/** Every executive linking the document by uuid. */
function addLinking(rows: Rows, doc: AtlasNode, index: VoteIndex | null): void {
  for (const l of index?.links.get(doc.id) ?? []) {
    if (l.kind !== "executive") continue;
    const spell = l.executive.cast && l.executive.spell ? { spell: l.executive.spell } : {};
    add(rows, { title: l.executive.title, date: l.date, url: l.executive.url, ...spell }, { kind: "links" });
  }
}

/** Every executive the matching ties to a dated claim in the document. */
function addClaimed(rows: Rows, doc: AtlasNode, docs: Record<string, AtlasNode>, index: VoteIndex | null, overlay: VoteEvidenceOverlay | null, today: Date): void {
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (const claim of extractDateClaims(doc, todayUTC).claims) {
    const e = overlayClaim({ ...claim, voteEvidence: index ? voteEvidence(claim, docs, index) : undefined }, overlay).voteEvidence;
    if (e?.vote?.kind !== "executive") continue;
    const spell = e.vote.spell ? { spell: e.vote.spell } : {};
    add(rows, { title: e.vote.title, date: e.vote.date, url: e.vote.url, ...spell }, { kind: "claim", raw: claim.raw, evidence: e });
  }
}
