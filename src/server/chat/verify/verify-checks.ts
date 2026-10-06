// Deterministic end-of-turn answer checks for the chat reliability harness —
// pure code, free, and authoritative: the verifier MODEL can never upgrade a
// failure found here (overall is computed in code, see verifier.ts).
// This module is the public surface: each check lives in its own sibling
// module, check-registry.ts lists them in report order, and everything callers
// import is re-exported from here. Kept dependency-light (pure modules, no
// Bun, no network) so the golden-eval grader can share the citation pattern.
import type { Indexes } from "../../retrieval/indexes.ts";
import type { CompletenessEvidence } from "./completeness.ts";
import { extractCitations } from "./citation-links.ts";
import { HARD_CHECK_KEYS, runChecks, type CheckReport, type HardCheckKey } from "./check-registry.ts";
import { previewEvidence } from "./preview-evidence.ts";

export {
  CITATION_SRC,
  MD_LINK_SRC,
  type Citation,
  extractCitations,
  findBareAtlasLinks,
  findInvalidCitationUuids,
  countUncitedParagraphs,
} from "./citation-links.ts";
export { extractDocNoMentions, findInvalidDocNos, findDocNoMismatches } from "./doc-no-checks.ts";
export { normalizeForMatch } from "./match-normalize.ts";
export { ABSENCE, isAttributedLeadIn } from "./quote-lead-in.ts";
export { type QuotedSpan, extractQuotedSpanRecords, extractQuotedSpans } from "./quote-spans.ts";
export { findUngroundedQuotes, findUngroundedQuoteSpans } from "./quote-grounding.ts";
export { findUngroundedAddresses, findUntracedNumbers } from "./value-grounding.ts";
export { citationValues, findUngroundedCitationValues, findMscCitedAsAtlas } from "./citation-values.ts";
export { contentWords, claimSegments } from "./claim-segments.ts";
export type { CheckReport } from "./check-registry.ts";

export function runDeterministicChecks(
  answer: string,
  evidenceTexts: string[],
  ix: Indexes,
  completeness?: { question: string; evidence: CompletenessEvidence[] },
  split?: { atlasTexts?: string[]; externalTexts?: string[] },
): CheckReport {
  const citations = extractCitations(answer);
  const atlasTexts = split?.atlasTexts ?? evidenceTexts;
  const fields = runChecks({
    answer,
    evidenceTexts,
    atlasTexts,
    externalTexts: split?.externalTexts ?? [],
    ix,
    citations,
    completeness,
    proposal: previewEvidence(atlasTexts),
  });
  return { citations, ...fields, lengthCapped: false, failed: isFailed({ ...fields, lengthCapped: false }) };
}

/**
 * The hard-failure rule, as ONE function: any `hard` entry of check-registry.ts
 * with a finding, or a length-capped answer.
 *
 * `gate` mode (chat-orchestrator.ts) drops tier-B spans from `ungroundedQuotes`
 * after a model has judged them, and then has to recompute this — so it cannot
 * be an inline expression, or the two would drift and a dropped span would
 * leave `failed` true with nothing to show for it. Soft signals (bare links,
 * uncited paragraphs, untraced numbers) inform; they don't fail.
 *
 * `lengthCapped` always arrives `false` from runDeterministicChecks (which
 * cannot know), but chat-orchestrator.ts's repairedChecks folds a capped answer
 * in by setting `failed: true` outright, so a gate-mode recompute that ignored
 * the flag would silently clear a real length-cap failure.
 */
export function isFailed(r: Pick<CheckReport, HardCheckKey>): boolean {
  return HARD_CHECK_KEYS.some((k) => {
    const v = r[k];
    return Array.isArray(v) ? v.length > 0 : v;
  });
}
