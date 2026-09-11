// Incremental deterministic verification (docs/chat-system.md §6, "Deferred
// (2026-09-10)" — deterministic half). Runs the same deterministic checks
// `runDeterministicChecks` runs, but PER PARAGRAPH as the answer streams,
// against the evidence retrieved so far, instead of only once over the
// finished answer. The full-text pass after `done` remains the authority: it
// alone owns completeness, the external disclaimer and the length cap —
// whole-answer properties a single paragraph can't judge. This is pure
// plumbing for a later per-paragraph MODEL audit (the refute slice); no model
// call happens here.
import type { Indexes } from "../../retrieval/indexes.ts";
import { expandReferenceLinks } from "./citation-normalize.ts";
import { repairCitations } from "./citation-repair.ts";
import {
  extractCitations,
  findInvalidCitationUuids,
  findInvalidDocNos,
  findDocNoMismatches,
  findUngroundedQuotes,
  findUngroundedAddresses,
  findUngroundedCitationValues,
  findMscCitedAsAtlas,
  type CheckReport,
} from "./verify-checks.ts";
import { findParamMismatches, formatParamMismatch } from "./param-checks.ts";
import { createParagraphSegmenter } from "./paragraphs.ts";

export interface ParagraphCheck {
  index: number;
  text: string;
  findings: string[];
}

// Evidence split by provenance, same shape the whole-answer pass uses
// (chat-orchestrator.ts's splitFromTranscript): atlas vs external (MSC) texts
// for the checks that must not cross-ground, plus the union for checks that
// don't care (address grounding, citation validity).
export interface ParagraphEvidence {
  atlasTexts: string[];
  externalTexts: string[];
  allTexts: string[];
}

type PartialReport = Pick<
  CheckReport,
  | "invalidCitations"
  | "invalidDocNos"
  | "docNoMismatches"
  | "ungroundedQuotes"
  | "ungroundedAddresses"
  | "ungroundedCitationValues"
  | "paramMismatches"
  | "mscCitedAsAtlas"
>;

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

// Wording mirrors apps/web/src/components/chat/VerifyFindings.tsx exactly —
// these strings are the same findings, just delivered earlier and per
// paragraph instead of once at the end.
export function describeFindings(r: PartialReport): string[] {
  const out: string[] = [];
  for (const uuid of r.invalidCitations) out.push(`cites a document that does not exist: ${uuid}`);
  for (const d of r.invalidDocNos) out.push(`document number does not exist in the atlas: ${d}`);
  for (const m of r.docNoMismatches) out.push(`document number doesn’t match its link: ${m}`);
  for (const q of r.ungroundedQuotes) out.push(`quote not found in any retrieved source: “${truncate(q, 120)}”`);
  for (const a of r.ungroundedAddresses) out.push(`address not found in any retrieved source: ${a}`);
  // Already complete sentences server-side, same as the whole-answer badge.
  for (const v of r.ungroundedCitationValues) out.push(v);
  for (const m of r.paramMismatches) out.push(formatParamMismatch(m));
  for (const m of r.mscCitedAsAtlas) out.push(m);
  return out;
}

export function checkParagraph(
  paragraph: string,
  definitions: string,
  ctx: { ix: Indexes; question: string; evidence: ParagraphEvidence },
): { text: string; findings: string[] } {
  // The spec form is `expandReferenceLinks(definitions + "\n\n" + paragraph)`;
  // skipping the join when there are no definitions avoids prepending two
  // blank lines that expandReferenceLinks only strips when a definition line
  // was actually removed (an inline-only paragraph must come back untouched).
  const combined = definitions ? `${definitions}\n\n${paragraph}` : paragraph;
  const expanded = expandReferenceLinks(combined);
  // The streaming link gate already repaired inline links token-by-token, but
  // it does not expand `[text][label]` reference uses — this also covers that
  // shape, and gives us the exact `text` this paragraph is checked against.
  const { content } = repairCitations(expanded.content, ctx.evidence.allTexts, ctx.ix);
  const citations = extractCitations(content);
  const report: PartialReport = {
    invalidCitations: findInvalidCitationUuids(citations, ctx.ix),
    invalidDocNos: findInvalidDocNos(content, ctx.ix),
    docNoMismatches: findDocNoMismatches(citations, ctx.ix),
    ungroundedQuotes: findUngroundedQuotes(content, ctx.evidence.atlasTexts, ctx.ix, ctx.question),
    ungroundedAddresses: findUngroundedAddresses(content, ctx.evidence.allTexts),
    ungroundedCitationValues: findUngroundedCitationValues(content, ctx.evidence.atlasTexts, ctx.ix),
    paramMismatches: findParamMismatches(content, ctx.ix),
    mscCitedAsAtlas: findMscCitedAsAtlas(content, ctx.evidence.externalTexts, ctx.ix),
  };
  return { text: content, findings: describeFindings(report) };
}

export interface ParagraphStream {
  push(text: string): ParagraphCheck[];
  flush(): ParagraphCheck | null;
  reset(): void;
}

// `evidence` is a getter, not a snapshot — evidence grows across tool rounds
// within a single generation burst, so each paragraph is checked against
// whatever has been retrieved by the time IT closes, not what was retrieved
// when the stream started.
export function createParagraphStream(ctx: {
  ix: Indexes;
  question: string;
  evidence: () => ParagraphEvidence;
}): ParagraphStream {
  const seg = createParagraphSegmenter();
  let index = 0;
  const checkOne = (paragraph: string): ParagraphCheck => {
    const { text, findings } = checkParagraph(paragraph, seg.definitions(), {
      ix: ctx.ix,
      question: ctx.question,
      evidence: ctx.evidence(),
    });
    return { index: index++, text, findings };
  };
  return {
    push: (text: string) => seg.push(text).map(checkOne),
    flush: () => {
      const p = seg.flush();
      return p ? checkOne(p) : null;
    },
    reset() {
      seg.reset();
      index = 0;
    },
  };
}
