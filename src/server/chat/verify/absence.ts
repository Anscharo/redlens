// Absence-claim contract (docs/research/synlang-wiki.md §3.1 background: the
// Phase 0 A/B found a "false absence" epidemic — the chatbot answering "the
// atlas does not specify X" when X has a configured value, and the sliced
// verifier's blanket absence exemption (verifier-slices.ts's SPAN_RULE —
// "no span can exist [for an absence claim]") passing it uncontested).
//
// This module replaces that blanket trust with a three-outcome contract for
// any claim the model marked `absence: true`:
//   REFUTED    — the parameter table proves the claim wrong (a real value exists).
//   GROUNDED   — the evidence itself shows a genuine gap (scaffold/placeholder
//                doc, or a search that empirically found nothing).
//   UNVERIFIED — neither: the claim is unproven either way.
// Precedence is refuted > grounded > unverified — a param row existing beats
// an empty search elsewhere in the turn (see sliced-verifier.ts's merge step,
// which applies this ONLY to claims already marked absence+supported; it does
// not touch validateSpans' span exemption, which is still correct — there IS
// no span to quote for a true gap).
import type { Indexes } from "../../retrieval/indexes.ts";
import { contentWords } from "./verify-checks.ts";
import { findParamsMentioned, formatParamValue } from "./param-checks.ts";

export interface AbsenceAudit {
  outcome: "grounded" | "refuted" | "unverified";
  detail: string;
}

// One retrieved tool result. `args` is the raw JSON of the originating call —
// load-bearing, not decoration: an empty search envelope ({"count":0,
// "results":[]}) carries no words of its own, so the QUERY is the only record
// of what was searched for, and therefore the only way to tell "nothing found
// for X" from "nothing found for something else entirely".
// Structurally satisfied by verifier.ts's EvidenceEntry.
export interface AbsenceEvidence {
  args?: string;
  content: string;
}

// Best refuting row for a claim: literal name-token matches outrank title-only
// matches (more specific — the model or claim named the actual kv key), and
// among ties a longer name is more specific still. findParamsMentioned already
// excludes ambiguous title/owner matches (verify-checks.ts's safeTitleOwnerUuids
// gate) — refuting an absence claim is a hard-failure-adjacent action (forces
// `contradicted`), so it needs that same precision bar, not a laxer one.
function bestRefutingMatch(claim: string, ix: Indexes) {
  const active = findParamsMentioned(claim, ix);
  if (active.length === 0) return null;
  return [...active].sort((a, b) => (a.byTitle !== b.byTitle ? (a.byTitle ? 1 : -1) : b.row.name.length - a.row.name.length))[0];
}

// The words every absence claim carries regardless of what it denies — the
// denial vocabulary (verify-checks.ts's ABSENCE_VERB list) plus "atlas". Built
// by running contentWords over them so the folding/stopword normalization is
// bit-identical to the matching side. What survives the filter is the claim's
// SUBJECT: the thing whose absence is being asserted.
const ABSENCE_VOCAB = new Set(
  contentWords(
    "atlas does not contain mention define include specify list name exist appear say state address cover " +
      "prescribe prohibit document record refer silent lacks lacking absent never available found documented " +
      "specified stated covered addressed mentioned defined explicit explicitly information detail value",
  ),
);

function claimSubject(claim: string): string[] {
  return contentWords(claim).filter((w) => !ABSENCE_VOCAB.has(w));
}

// A tool result that genuinely found nothing (raw JSON signature — NOT
// round-checks.ts's isEmptyResult, which returns false for a populated `mode`
// field on a real search envelope and so could never fire here), or a doc
// tagged scaffold/placeholder by the liveness census (src/lib/liveness.ts,
// surfaced per-row in tool-result JSON by the atlas_params/search tooling).
//
// SCOPED to the claim's subject. Turn-wide scanning was the flaw: a chat turn
// makes several tool calls, and one unrelated empty result — atlas_params is
// especially prone to them, its token-containment matcher returning count:0
// far more readily than atlas_search — would ground an absence claim about a
// completely different parameter. An evidence entry counts only when its query
// or its result text names something the claim also names.
//
// Granularity limit, stated rather than hidden: scoping is per EVIDENCE ENTRY,
// not per row inside it. A multi-row envelope that mentions the subject AND
// carries an unrelated scaffold row can still ground. Narrowing that needs
// row-level parsing of every tool envelope shape; entry-level already closes
// the cross-tool-call case that made this load-bearing.
function groundedSignal(subject: string[], evidence: AbsenceEvidence[]): string | null {
  // A claim with no subject left after filtering ("the atlas is silent on
  // this") can't be scoped at all — fall back to turn-wide rather than
  // failing every anaphoric claim outright.
  const scoped = subject.length
    ? evidence.filter((e) => {
        const words = new Set(contentWords(`${e.args ?? ""} ${e.content}`));
        return subject.some((w) => words.has(w));
      })
    : evidence;
  for (const e of scoped) {
    if (e.content.includes('"liveness":"scaffold"')) return "liveness:scaffold";
    if (e.content.includes('"liveness":"placeholder"')) return "liveness:placeholder";
  }
  for (const e of scoped) {
    if (/"count"\s*:\s*0\b/.test(e.content) || /"results"\s*:\s*\[\s*\]/.test(e.content)) return "empty-result";
  }
  return null;
}

export function auditAbsenceClaim(claim: string, evidence: AbsenceEvidence[], ix: Indexes): AbsenceAudit {
  const match = bestRefutingMatch(claim, ix);
  if (match) {
    const { row } = match;
    // Bare fact only — the composing sites (sliced-verifier note/feedback)
    // prefix their own "absence-refuted:" framing.
    return {
      outcome: "refuted",
      detail: `${row.name}${row.owner ? ` (${row.owner})` : ""} = ${formatParamValue(row)} (${row.doc_no})`,
    };
  }
  const signal = groundedSignal(claimSubject(claim), evidence);
  if (signal) return { outcome: "grounded", detail: `grounded: ${signal}` };
  return {
    outcome: "unverified",
    detail:
      "could not verify the claimed absence — no empty-result or scaffold evidence about it, and no parameter-table refutation",
  };
}
