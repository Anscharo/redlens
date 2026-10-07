// The votes behind one atlas document, for the reader's "votes" panel: every
// vote that links the document by uuid, and every vote the Stale Dates
// matching (with the worker's refinements, ./overlay.ts) ties to one of its
// dated claims. One row per vote, newest first, each with why it is listed.
// Pure.

import type { AtlasNode } from "../../types";
import { extractDateClaims } from "../staleDates";
import { voteEvidence, type VoteEvidence } from "./evidence";
import { overlayClaim, type VoteEvidenceOverlay } from "./overlay";
import type { VoteIndex } from "./vote-index";

export type DocVoteReason =
  | { kind: "links" } // the vote links this document
  | { kind: "claim"; raw: string; evidence: VoteEvidence }; // matched to a dated claim in it

export interface DocVote {
  kind: "executive" | "poll";
  title: string;
  date: string;
  url: string;
  reasons: DocVoteReason[];
}

export function votesForDoc(
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
    const v = l.kind === "executive" ? { kind: l.kind, title: l.executive.title, date: l.date, url: l.executive.url } : { kind: l.kind, title: l.title, date: l.date, url: l.url };
    add(v, { kind: "links" });
  }
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (const claim of extractDateClaims(doc, todayUTC).claims) {
    const e = overlayClaim({ ...claim, voteEvidence: index ? voteEvidence(claim, docs, index) : undefined }, overlay).voteEvidence;
    if (e?.vote) add({ kind: e.vote.kind, title: e.vote.title, date: e.vote.date, url: e.vote.url }, { kind: "claim", raw: claim.raw, evidence: e });
  }
  return [...rows.values()].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}
