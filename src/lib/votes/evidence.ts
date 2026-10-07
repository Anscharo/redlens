// Vote evidence for a dated atlas claim: which vote, if any, the vote record
// shows carrying it. Two keys, each used only where measurement showed it holds:
//
// - A claim that names an Executive Vote by date resolves to the executive
//   whose filename carries that date (a spell may slip up to SLIP_DAYS), and
//   the subject check (./subject.ts) decides whether that executive carried it.
// - Any other claim resolves only through a vote that links its document by
//   uuid (the document or a near parent), inside LINK_WINDOW of the date.
//
// A claim with neither key is "unlinked", which is not evidence of absence:
// most effective-date claims are authorised by weekly polls that link nothing.

import type { AtlasNode } from "../../types";
import type { VoteRef } from "./claim";
import { checkSubject, type SubjectCheck } from "./subject";
import { addDays, executiveFor, linkedVotes, offset, SLIP_DAYS, type IndexedExecutive, type VoteIndex } from "./vote-index";

export type VoteEvidenceStatus =
  | "enacted" // the vote carried the claim and has been cast
  | "vote-on-date" // a cast executive on the date; the sentence names nothing checkable
  | "pending" // the matching executive is drafted or not yet cast
  | "subject-missing" // an executive on the date that never mentions the claim's subject
  | "no-vote" // the record covers the date and holds no executive for it
  | "not-covered" // the date falls outside the vote record
  | "authorised" // only a passed poll links the claim's document
  | "unlinked"; // no vote names or links the claim

export interface VoteMatch {
  kind: "executive" | "poll";
  title: string;
  date: string;
  url: string;
  /** Vote date minus claim date, in days. */
  offsetDays: number;
}

export interface VoteEvidence {
  status: VoteEvidenceStatus;
  via: "date" | "link" | null;
  vote: VoteMatch | null;
  subject: Pick<SubjectCheck, "found" | "missing"> | null;
}

interface ClaimKey {
  docId: string;
  dateISO: string;
  vote: VoteRef | null;
}

export function voteEvidence(claim: ClaimKey, docs: Record<string, AtlasNode>, index: VoteIndex): VoteEvidence {
  return claim.vote ? byDate(claim.dateISO, claim.vote, index) : byLink(claim, docs, index);
}

function byDate(dateISO: string, ref: VoteRef, index: VoteIndex): VoteEvidence {
  const e = executiveFor(index, dateISO, ref.outOfSchedule);
  if (!e) {
    const outside = dateISO < index.first || addDays(dateISO, SLIP_DAYS) > index.last;
    return { status: outside ? "not-covered" : "no-vote", via: null, vote: null, subject: null };
  }
  const check = ref.anchor ? null : checkSubject(ref.subject, e.text, index.corpus);
  const subject = check && check.verdict !== "unchecked" ? { found: check.found, missing: check.missing } : null;
  return { status: dateStatus(e, check), via: "date", vote: executiveMatch(e, dateISO), subject };
}

function dateStatus(e: IndexedExecutive, check: SubjectCheck | null): VoteEvidenceStatus {
  if (check?.verdict === "missing") return "subject-missing";
  if (!e.cast) return "pending";
  return check?.verdict === "found" ? "enacted" : "vote-on-date";
}

function byLink(claim: ClaimKey, docs: Record<string, AtlasNode>, index: VoteIndex): VoteEvidence {
  const hit = linkedVotes(index, claim.docId, docs, claim.dateISO)[0];
  if (!hit) return { status: "unlinked", via: null, vote: null, subject: null };
  if (hit.kind === "poll") {
    const vote: VoteMatch = { kind: "poll", title: hit.title, date: hit.date, url: hit.url, offsetDays: offset(claim.dateISO, hit.date) };
    return { status: "authorised", via: "link", vote, subject: null };
  }
  const status = hit.executive.cast ? "enacted" : "pending";
  return { status, via: "link", vote: executiveMatch(hit.executive, claim.dateISO), subject: null };
}

function executiveMatch(e: IndexedExecutive, dateISO: string): VoteMatch {
  return { kind: "executive", title: e.title, date: e.date, url: e.url, offsetDays: offset(dateISO, e.date) };
}
