// Deterministic end-of-turn answer checks for the chat reliability harness —
// pure code, free, and authoritative: the verifier MODEL can never upgrade a
// failure found here (overall is computed in code, see verifier.ts).
// Kept dependency-light (patterns.ts only, plus the Indexes type) so the
// golden-eval grader can share the citation pattern without dragging in Bun.
import { UUID_RE } from "../lib/patterns.ts";
import type { Indexes } from "./indexes.ts";

// The system prompt's citation link format: [Title](/atlas/<uuid>). ONE source
// of truth shared with scripts/aux/eval-golden-grade.ts so grader and runtime
// can't drift. Exported as a source string (not a RegExp) because the runtime
// needs a fresh /g instance per scan — shared global regexes carry lastIndex.
export const CITATION_SRC = `\\[([^\\]]+)\\]\\(/atlas/(${UUID_RE.source.slice(1, -1)})\\)`;

export interface Citation {
  title: string;
  uuid: string;
}

export function extractCitations(answer: string): Citation[] {
  const re = new RegExp(CITATION_SRC, "gi");
  const out: Citation[] = [];
  for (let m = re.exec(answer); m; m = re.exec(answer)) {
    out.push({ title: m[1], uuid: m[2].toLowerCase() });
  }
  return out;
}

// Links into the reader that are NOT well-formed uuid citations — e.g. a
// doc_no or a truncated uuid in the href. Signals the model inventing hrefs.
export function findBareAtlasLinks(answer: string): string[] {
  const re = /\]\((\/atlas\/[^)\s]*)\)/g;
  const wellFormed = new RegExp(`^/atlas/${UUID_RE.source.slice(1, -1)}$`, "i");
  const out: string[] = [];
  for (let m = re.exec(answer); m; m = re.exec(answer)) {
    if (!wellFormed.test(m[1])) out.push(m[1]);
  }
  return out;
}

export function findInvalidCitationUuids(citations: Citation[], ix: Indexes): string[] {
  return [...new Set(citations.filter((c) => !ix.docMap.has(c.uuid)).map((c) => c.uuid))];
}

// Doc-number mentions anywhere in the answer (prose or link text): editorial
// doc_nos (A.1.6) plus the spec-invariant structural forms (.varX, NR-X). The
// letter prefix must lead straight into dotted digits, so prose like "Q1 2026"
// or "v1.2" never matches. Source string, not RegExp — fresh /g per scan.
const DOC_NO_CORE = String.raw`(?:[A-Z]{1,3}(?:\.\d+)+(?:\.var\d+)?|NR-\d+)`;

export function extractDocNoMentions(answer: string): string[] {
  return [...new Set(answer.match(new RegExp(String.raw`\b${DOC_NO_CORE}\b`, "g")) ?? [])];
}

// Every mentioned doc number must exist in the atlas — models keep inventing
// plausible-looking numbers, and a fabricated number is a hard failure even
// when the surrounding claim is right.
export function findInvalidDocNos(answer: string, ix: Indexes): string[] {
  return extractDocNoMentions(answer).filter((d) => !ix.byDocNo.has(d));
}

// Citations whose link text leads with a doc number that is not the linked
// doc's actual number — deterministic proof of misattribution even when the
// number and the uuid both exist individually.
export function findDocNoMismatches(citations: Citation[], ix: Indexes): string[] {
  const out: string[] = [];
  for (const c of citations) {
    const claimed = c.title.match(new RegExp(String.raw`^${DOC_NO_CORE}\b`))?.[0];
    const doc = ix.docMap.get(c.uuid);
    if (claimed && doc && doc.doc_no !== claimed) out.push(`${claimed} links to ${doc.doc_no} (${doc.title})`);
  }
  return [...new Set(out)];
}

// Substantive paragraphs with no citation link. A soft signal (the answer's
// lead sentence or a summary bullet legitimately goes uncited) — reported to
// the verifier prompt, never a hard failure on its own.
export function countUncitedParagraphs(answer: string): number {
  const citation = new RegExp(CITATION_SRC, "i");
  return answer
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 120 && !/^#{1,6}\s/.test(p) && !p.startsWith("|"))
    .filter((p) => !citation.test(p)).length;
}

// Whitespace/case/punctuation-tolerant containment form. Curly quotes and
// markdown emphasis are authoring noise, not evidence differences.
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Quoted spans the answer presents as verbatim atlas text: markdown blockquote
// lines and inline double-quoted runs. Short quotes (<25 normalized chars) are
// skipped — too likely to be incidental phrasing, not a verbatim claim.
// Attribution is authoring, not quotation: models routinely close a blockquote
// with "— [Title](/atlas/…)", so a trailing dash-led citation is cut and any
// remaining markdown link collapses to its text before matching.
function stripQuoteDecoration(span: string): string {
  return span
    .replace(/\s*[—–-]{1,2}\s*\[[^\]]*\]\([^)]*\)\s*$/, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

export function extractQuotedSpans(answer: string): string[] {
  const spans: string[] = [];
  for (const line of answer.split("\n")) {
    const bq = line.match(/^\s*>\s?(.+)$/);
    if (bq) spans.push(bq[1]);
  }
  const inline = /["“]([^"“”]{10,})["”]/g;
  for (let m = inline.exec(answer); m; m = inline.exec(answer)) spans.push(m[1]);
  return [...new Set(spans.map((s) => normalizeForMatch(stripQuoteDecoration(s))).filter((s) => s.length >= 25))];
}

// Quotation conventions are not evidence differences: "..." elision and
// bracketed editorial insertions ("[of]", "[sic]") split a quote into
// contiguous segments, each verified independently, and punctuation hugging
// the quotation marks is the author's, not the source's. Segments too short
// to verify meaningfully (<12 chars) are skipped.
function quoteSegments(span: string): string[] {
  return span
    .split(/\.{3,}|…|\[[^\]]{0,40}\]/)
    .map((seg) => seg.replace(/^[\s"',.;:!?()—–-]+|[\s"',.;:!?()—–-]+$/g, ""))
    .filter((seg) => seg.length >= 12);
}

// A quote is grounded if every verifiable segment appears in the turn's
// tool-result evidence or in the title/content of any doc the answer cites.
export function findUngroundedQuotes(answer: string, evidenceTexts: string[], ix: Indexes): string[] {
  const spans = extractQuotedSpans(answer);
  if (spans.length === 0) return [];
  const haystacks = [
    ...evidenceTexts.map(normalizeForMatch),
    ...extractCitations(answer).map((c) => {
      const doc = ix.docMap.get(c.uuid);
      return normalizeForMatch(doc ? `${doc.title}\n${doc.content}` : "");
    }),
  ];
  return spans.filter((s) => quoteSegments(s).some((seg) => !haystacks.some((h) => h.includes(seg))));
}

export interface CheckReport {
  citations: Citation[];
  invalidCitations: string[];
  invalidDocNos: string[];
  docNoMismatches: string[];
  bareAtlasLinks: string[];
  uncitedParagraphs: number;
  ungroundedQuotes: string[];
  // Hard deterministic failure — invented citation targets, invented/misattributed
  // doc numbers, or invented quotes. Soft signals (bare links, uncited
  // paragraphs) inform, they don't fail.
  failed: boolean;
}

export function runDeterministicChecks(answer: string, evidenceTexts: string[], ix: Indexes): CheckReport {
  const citations = extractCitations(answer);
  const invalidCitations = findInvalidCitationUuids(citations, ix);
  const invalidDocNos = findInvalidDocNos(answer, ix);
  const docNoMismatches = findDocNoMismatches(citations, ix);
  const ungroundedQuotes = findUngroundedQuotes(answer, evidenceTexts, ix);
  return {
    citations,
    invalidCitations,
    invalidDocNos,
    docNoMismatches,
    bareAtlasLinks: findBareAtlasLinks(answer),
    uncitedParagraphs: countUncitedParagraphs(answer),
    ungroundedQuotes,
    failed: invalidCitations.length > 0 || invalidDocNos.length > 0 || docNoMismatches.length > 0 || ungroundedQuotes.length > 0,
  };
}
