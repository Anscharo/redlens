// Deterministic post-answer repair and checks: reference-link normalization,
// citation repair, identifier-leak repair, and the checks that judge the
// repaired text. Pure — no model calls.
import { config } from "../../config.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import { runDeterministicChecks, type CheckReport } from "../verify/verify-checks.ts";
import { isReviewRound } from "../review-round.ts";
import type { CompletenessEvidence } from "../verify/completeness.ts";
import { createLinkJudge, repairCitations, resolveLabelToUuid, type CitationRepair } from "../verify/citation-repair.ts";
import { expandReferenceLinks, type ReferenceExpansion } from "../verify/citation-normalize.ts";
import { repairIdentifierLeaks, type IdentifierRepair } from "../verify/identifier-leak.ts";
import { evidenceFromTranscript, isAtlasText } from "../verify/verifier.ts";
import { withTeachHint } from "../teach/hint.ts";
import type { DoneEvent, Msg } from "./types.ts";

// Reference-style citations — `[text][label]` plus a `[label]: /atlas/<uuid>`
// definition block — are expanded to the canonical inline form BEFORE repair
// and before the deterministic checks, so the whole checking layer keeps
// keying on one shape (docs/plans/reference-citations.md). Repair remains the
// authority; it simply operates on the canonical form, which it has to, since
// a garbled UUID in a reference answer lives in a definition line that is not
// a `[text](href)` link at all.
//
// The repaired result becomes done.content whenever it differs from what the
// model wrote — the comparison at each call site is against the ORIGINAL, not
// the normalized string, so a normalization-only fix still ships. That is a
// deliberate, narrow exception to the "streamed text and done.content must not
// disagree" guard:
//   • inline-only answers normalize byte-identically, so this is a
//     strict no-op and the guard is untouched;
//   • a well-formed reference answer renders identically either way (remark
//     resolves reference links to the same <a href="/atlas/…"> and drops the
//     definition nodes), so the swap is invisible to the user;
//   • where the swap IS visible it is precisely the repair — the two measured
//     malformed shapes otherwise ship as literal brackets in the prose;
//   • and done.content is what the verifier, the Sources cluster and the
//     persisted message all read, so one canonical shape across those
//     consumers beats byte-fidelity to raw model output.
// Exported for the offline evals (scripts/eval/eval-bakeoff.ts), which must grade
// the string production would SHIP: a reference-style answer has no inline
// citations at all until this runs, so a checker fed the raw model output scores
// every well-formed reference answer as uncited.
export function normalizeAndRepair(content: string, toolTexts: string[], ix: Indexes): { refs: ReferenceExpansion; repair: CitationRepair; identifiers: IdentifierRepair } {
  // A used-but-undeclared label is resolved against this turn's retrieved docs
  // and synthesized as an inline link when it maps uniquely (undefined-label
  // degradation); unresolvable ones the normalizer strips to plain text and
  // reports.
  const judge = createLinkJudge(toolTexts, ix);
  const resolveLabel = (label: string): string | null => {
    const uuid = resolveLabelToUuid(label, judge);
    return uuid ? `/atlas/${uuid}` : null;
  };
  const refs = expandReferenceLinks(content, resolveLabel);
  const repair = repairCitations(refs.content, toolTexts, ix);
  // Last: internal machine handles pasted into prose as pseudo-citations
  // (`(Slug: grove-freezer-multisig)`) become real citations when the handle
  // names a doc retrieved this turn, and vanish otherwise. Folded into
  // repair.content because every call site swaps on that one string.
  const identifiers = repairIdentifierLeaks(repair.content, toolTexts, ix);
  return { refs, repair: { ...repair, content: identifiers.content }, identifiers };
}

// Reference bookkeeping for the checks row — observability only, never a
// verdict. The remaining `undefinedLabels` here are the ones that could NOT be
// resolved to a retrieved doc (the resolvable ones were already synthesized
// into inline links by normalizeAndRepair) and were de-linkified to plain text
// — recorded here, never a failure (the reader saw prose, not a bad link).
// `undefined` so the key vanishes from the persisted JSON on the
// overwhelmingly common turn that uses no reference syntax at all.
export function refsMeta(r: ReferenceExpansion) {
  if (r.definitions.size + r.undefinedLabels.length + r.unusedLabels.length === 0) return undefined;
  return { definitions: r.definitions.size, undefinedLabels: r.undefinedLabels, unusedLabels: r.unusedLabels };
}

// Same bookkeeping shape for leaked machine handles: observability only (the
// leak is already gone from the shipped text), `undefined` so the key vanishes
// from the persisted JSON on the turns — nearly all of them — with no leak.
export function identifiersMeta(i: IdentifierRepair) {
  if (i.linkified.length + i.removed.length === 0) return undefined;
  return { linkified: i.linkified, removed: i.removed };
}

// Repair the answer's atlas links in code. A link the repair could not
// resolve is de-linkified (stream-link-gate.ts did the same to the token
// stream), so the reader never sees it — and the checks judge what the reader
// sees: a stripped link is NOT folded back in as a failure, because that
// would raise a red badge naming a doc that appears nowhere in the shipped
// answer. The strip is still recorded on the round_checks row for
// calibration. Unresolvable reference labels (de-linkified to plain text by
// the normalizer) are treated identically. Only a length-capped answer (cut
// off mid-generation) still forces `failed`: the reader sees the truncation.
export function repairedChecks(
  content: string,
  toolTexts: string[],
  ix: Indexes,
  lengthCapped: boolean,
  completeness?: { question: string; evidence: CompletenessEvidence[] },
  split?: { atlasTexts?: string[]; externalTexts?: string[] },
): CheckReport {
  const checks = runDeterministicChecks(content, toolTexts, ix, completeness, split);
  if (!lengthCapped) return checks;
  return { ...checks, lengthCapped, failed: true };
}

// Every real tool result, and NOT the synthetic review round. That round carries
// verifier output about this same conversation, including a truncated atlas span
// per flag, so leaving it in would let the deterministic checks certify a quote
// against the verifier's own excerpt — exactly what verifier.ts deliberately
// refuses to do for the model audit ("the conservative direction").
export const toolTextsOf = (transcript: Msg[]): string[] =>
  transcript
    .filter((m) => m.role === "tool" && typeof m.content === "string" && !isReviewRound(m.tool_call_id))
    .map((m) => m.content as string);

export function splitFromTranscript(transcript: Msg[]): { atlasTexts: string[]; externalTexts: string[] } {
  const entries = evidenceFromTranscript(transcript, 500_000);
  return {
    // ALLOWLIST (verifier.ts's isAtlasText), not "everything that isn't
    // external or user". Atlas text is the class quote-grounding certifies
    // against, so an unrecognised tool result must never fall into it.
    atlasTexts: entries.filter((e) => isAtlasText(e.sourceClass)).map((e) => e.content),
    externalTexts: entries.filter((e) => e.sourceClass === "external").map((e) => e.content),
  };
}

export function applyTeachHint(d: DoneEvent): DoneEvent {
  if (!config.chatTeach || !d.content.trim()) return d;
  const content = withTeachHint(d.content);
  return content === d.content ? d : { ...d, content };
}
