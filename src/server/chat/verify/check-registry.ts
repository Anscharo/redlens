// The deterministic checks, one entry per CheckReport field, in report order.
// Adding a check is a new module plus one appended entry here and its field on
// CheckReport; `hard` decides whether a finding fails the turn (isFailed).
import type { Indexes } from "../../retrieval/indexes.ts";
import { answerHasMscDisclaimer } from "../../external/envelope.ts";
import { findParamMismatches, type ParamMismatch } from "./param-checks.ts";
import { completenessFailuresOf, type CompletenessEvidence } from "./completeness.ts";
import { countUncitedParagraphs, findBareAtlasLinks, findInvalidCitationUuids, type Citation } from "./citation-links.ts";
import { findDocNoMismatches, findInvalidDocNos } from "./doc-no-checks.ts";
import { findUngroundedQuotes } from "./quote-grounding.ts";
import { findUngroundedAddresses, findUntracedNumbers } from "./value-grounding.ts";
import { findMscCitedAsAtlas, findUngroundedCitationValues } from "./citation-values.ts";

export interface CheckReport {
  citations: Citation[];
  invalidCitations: string[];
  invalidDocNos: string[];
  docNoMismatches: string[];
  bareAtlasLinks: string[];
  uncitedParagraphs: number;
  ungroundedQuotes: string[];
  ungroundedAddresses: string[];
  // Values used as citation link text (a number, percentage, date, or address)
  // that occur in this turn's evidence but NOT in the specific doc they cite —
  // a real figure attributed to the wrong document. A HARD failure.
  ungroundedCitationValues: string[];
  untracedNumbers: string[];
  // Wrong stated value for a KNOWN atlas parameter (the derived param table,
  // param-checks.ts's findParamMismatches) — a HARD failure like the other
  // invented facts.
  paramMismatches: ParamMismatch[];
  // Exhaustive/extremum questions answered from a ranked page (or hedged
  // "among those queried") — hard fail; recovery must requery the class.
  completenessFailures: string[];
  // External MSC brief was in this turn but the answer omitted the required
  // non-Atlas attribution. HARD failure.
  missingExternalDisclaimer: boolean;
  // Settlement figures from the external MSC brief cited as /atlas/<uuid>.
  // HARD failure even when the same digits also occur in the cited atlas doc
  // (that coincidence is exactly how MSC dollars would slip through).
  mscCitedAsAtlas: string[];
  // True when the answer was cut off by the output-token cap (chat-loop.ts's
  // finish_reason "length") rather than ending on its own. Not derivable from
  // the answer text — set by the caller, defaults false here.
  lengthCapped: boolean;
  // Hard deterministic failure — invented citation targets, invented/misattributed
  // doc numbers, invented quotes, invented addresses, or a length-capped answer.
  // Soft signals (bare links, uncited paragraphs, untraced numbers) inform,
  // they don't fail.
  failed: boolean;
}

interface CheckContext {
  answer: string;
  /** Every tool result of the turn, atlas and external alike. */
  evidenceTexts: string[];
  /** Atlas-only evidence: what quotes and citation values must ground in. */
  atlasTexts: string[];
  /** The external MSC brief's texts; empty when it was not in this turn. */
  externalTexts: string[];
  ix: Indexes;
  citations: Citation[];
  completeness?: { question: string; evidence: CompletenessEvidence[] };
}

type CheckFields = Omit<CheckReport, "citations" | "lengthCapped" | "failed">;
type CheckEntry = {
  [K in keyof CheckFields]: { key: K; hard: boolean; run: (c: CheckContext) => CheckFields[K] };
}[keyof CheckFields];

const CHECKS = [
  { key: "invalidCitations", hard: true, run: (c) => findInvalidCitationUuids(c.citations, c.ix) },
  { key: "invalidDocNos", hard: true, run: (c) => findInvalidDocNos(c.answer, c.ix) },
  { key: "docNoMismatches", hard: true, run: (c) => findDocNoMismatches(c.citations, c.ix) },
  { key: "bareAtlasLinks", hard: false, run: (c) => findBareAtlasLinks(c.answer) },
  { key: "uncitedParagraphs", hard: false, run: (c) => countUncitedParagraphs(c.answer) },
  {
    key: "ungroundedQuotes",
    hard: true,
    run: (c) => findUngroundedQuotes(c.answer, c.atlasTexts, c.ix, c.completeness?.question),
  },
  { key: "ungroundedAddresses", hard: true, run: (c) => findUngroundedAddresses(c.answer, c.evidenceTexts) },
  {
    key: "ungroundedCitationValues",
    hard: true,
    run: (c) => findUngroundedCitationValues(c.answer, c.atlasTexts, c.ix),
  },
  { key: "untracedNumbers", hard: false, run: (c) => findUntracedNumbers(c.answer, c.evidenceTexts) },
  { key: "paramMismatches", hard: true, run: (c) => findParamMismatches(c.answer, c.ix) },
  {
    key: "completenessFailures",
    hard: true,
    run: (c) => completenessFailuresOf(c.completeness?.question, c.answer, c.completeness?.evidence),
  },
  {
    key: "missingExternalDisclaimer",
    hard: true,
    run: (c) => c.externalTexts.length > 0 && !answerHasMscDisclaimer(c.answer),
  },
  { key: "mscCitedAsAtlas", hard: true, run: (c) => findMscCitedAsAtlas(c.answer, c.externalTexts, c.ix) },
] as const satisfies readonly CheckEntry[];

/** The report fields whose non-empty (or true) value fails the turn. */
export type HardCheckKey = Extract<(typeof CHECKS)[number], { hard: true }>["key"] | "lengthCapped";

export const HARD_CHECK_KEYS: readonly HardCheckKey[] = [
  ...CHECKS.filter((c) => c.hard).map((c) => c.key as HardCheckKey),
  "lengthCapped",
];

export function runChecks(ctx: CheckContext): CheckFields {
  return Object.fromEntries(CHECKS.map((c) => [c.key, c.run(ctx)])) as CheckFields;
}
