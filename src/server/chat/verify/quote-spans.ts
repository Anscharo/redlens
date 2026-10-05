// Quoted spans the answer presents as verbatim atlas text: markdown blockquote
// lines and inline double-quoted runs. Short quotes (<25 normalized chars) are
// skipped — too likely to be incidental phrasing, not a verbatim claim.
import { MD_LINK_SRC } from "./citation-links.ts";
import { normalizeForMatch } from "./match-normalize.ts";
import { ABSENCE, isAttributionLine, isSelfAuthoredCallout, isSelfAuthorshipLeadIn } from "./quote-lead-in.ts";

const MD_LINKS = new RegExp(MD_LINK_SRC, "g");
const TRAILING_CITATION = new RegExp(String.raw`\s*[—–-]{1,2}\s*` + MD_LINK_SRC + String.raw`\s*(?:\([^)]*\))?\s*$`);

// A trailing dash-led citation is attribution, so it is cut; other links collapse to their text.
function stripQuoteDecoration(span: string): string {
  return span.replace(TRAILING_CITATION, "").replace(MD_LINKS, "$1");
}

// A quoted TERM the answer denies (`does not contain "X"`) is a mention: its
// absence is the claim. Narrow: same clause, nearby, and term-length only.
const DENIAL_BEFORE = new RegExp(ABSENCE + String.raw`[^.!?;:]{0,40}$`, "i");
const DENIAL_AFTER = new RegExp(String.raw`^[^.!?;:]{0,80}?` + ABSENCE, "i");
const MAX_DENIED_TERM = 60;

interface QuotedPair {
  text: string;
  start: number;
  end: number;
}

// Pair first, filter after: a single regex desyncs pairing when a span is
// skipped and captures the prose BETWEEN two quoted terms.
function quotedPairs(line: string): QuotedPair[] {
  const marks: number[] = [];
  for (let i = 0; i < line.length; i++) if (line[i] === '"' || line[i] === "“" || line[i] === "”") marks.push(i);
  const out: QuotedPair[] = [];
  for (let i = 0; i + 1 < marks.length; i += 2) {
    out.push({ text: line.slice(marks[i] + 1, marks[i + 1]), start: marks[i], end: marks[i + 1] });
  }
  return out;
}

// Citations at the END of a blockquote line are attribution. Only the tail is
// stripped: a mid-sentence link may be part of the quoted atlas text.
const TRAILING_CITATIONS = /(?:\s*(?:\[[^\]]+\]\([^)\s]+\)|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))+\s*[.,;:]?\s*$/i;

// `leadInSeed` carries the lead-in into the per-paragraph pass, which would
// otherwise flag a callout the final pass clears.
export interface QuotedSpan {
  /** Normalized span text — the key every grounding check matches on. */
  text: string;
  /** The line or prose that introduced it; decides tier A vs tier B. */
  leadIn: string;
}

function blockquoteSpans(answer: string, leadInSeed: string): QuotedSpan[] {
  const spans: QuotedSpan[] = [];
  // Every line of a multi-line block shares the lead-in above the block.
  let leadIn = leadInSeed;
  for (const line of answer.split("\n")) {
    const bq = line.match(/^\s*>\s?(.+)$/);
    if (!bq) {
      if (line.trim()) leadIn = line;
      continue;
    }
    if (!isAttributionLine(bq[1]) && !isSelfAuthoredCallout(bq[1]) && !isSelfAuthorshipLeadIn(leadIn)) {
      // The lead-in is ONLY the line above: including the span would let
      // ASSERTION_VERB match words inside it and wrongly make it tier A.
      spans.push({ text: stripQuoteDecoration(bq[1].replace(TRAILING_CITATIONS, "")), leadIn });
    }
  }
  return spans;
}

// Inline quotes that are not verbatim-quotation claims, in the order checked.
function isExemptInlineQuote(q: QuotedPair, line: string): boolean {
  if (q.text.length < 10) return true;
  const beforeQuote = line.slice(0, q.start);
  const afterQuote = line.slice(q.end + 1);
  if (q.text.length <= MAX_DENIED_TERM && (DENIAL_BEFORE.test(beforeQuote) || DENIAL_AFTER.test(afterQuote))) {
    return true;
  }
  // A quoted QUESTION is an example for the reader to ask, never rule text.
  if (/\?["”']*\s*$/.test(q.text.trim())) return true;
  // A list item that is ENTIRELY one quoted string is an example, not a quotation.
  return /^\s*[-*+]\s*$/.test(beforeQuote) && /^[.?!,;:]*\s*$/.test(afterQuote);
}

function inlineSpans(answer: string): QuotedSpan[] {
  const spans: QuotedSpan[] = [];
  // Collapse links FIRST, or quotes in two link titles pair into a phantom span.
  const flat = answer.replace(MD_LINKS, "$1");
  for (const line of flat.split("\n")) {
    for (const q of quotedPairs(line)) {
      if (isExemptInlineQuote(q, line)) continue;
      // Lead-in is the prose BEFORE the quote only, as for blockquotes.
      spans.push({ text: q.text, leadIn: line.slice(0, q.start) });
    }
  }
  return spans;
}

export function extractQuotedSpanRecords(answer: string, leadInSeed = ""): QuotedSpan[] {
  // Dedupe on normalized text, keeping the FIRST occurrence's lead-in.
  const out: QuotedSpan[] = [];
  const seen = new Set<string>();
  for (const s of [...blockquoteSpans(answer, leadInSeed), ...inlineSpans(answer)]) {
    const text = normalizeForMatch(s.text);
    if (text.length < 25 || seen.has(text)) continue;
    seen.add(text);
    out.push({ text, leadIn: s.leadIn });
  }
  return out;
}

export function extractQuotedSpans(answer: string, leadInSeed = ""): string[] {
  return extractQuotedSpanRecords(answer, leadInSeed).map((s) => s.text);
}
