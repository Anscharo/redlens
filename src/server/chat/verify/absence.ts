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
import { findParamsMentioned, formatParamValue } from "./verify-checks.ts";

export interface AbsenceAudit {
  outcome: "grounded" | "refuted" | "unverified";
  detail: string;
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

// A tool result that genuinely found nothing (raw JSON signature — NOT
// round-checks.ts's isEmptyResult, which returns false for a populated `mode`
// field on a real search envelope and so could never fire here), or a doc
// tagged scaffold/placeholder by the liveness census (src/lib/liveness.ts,
// surfaced per-row in tool-result JSON by the atlas_params/search tooling).
function groundedSignal(evidenceTexts: string[]): string | null {
  for (const t of evidenceTexts) {
    if (t.includes('"liveness":"scaffold"')) return "liveness:scaffold";
    if (t.includes('"liveness":"placeholder"')) return "liveness:placeholder";
  }
  for (const t of evidenceTexts) {
    if (/"count"\s*:\s*0\b/.test(t) || /"results"\s*:\s*\[\s*\]/.test(t)) return "empty-result";
  }
  return null;
}

export function auditAbsenceClaim(claim: string, evidenceTexts: string[], ix: Indexes): AbsenceAudit {
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
  const signal = groundedSignal(evidenceTexts);
  if (signal) return { outcome: "grounded", detail: `grounded: ${signal}` };
  return {
    outcome: "unverified",
    detail: "could not verify the claimed absence — no empty-result or scaffold evidence, and no parameter-table refutation",
  };
}
