// Quoted spans the answer presents as verbatim atlas text: markdown blockquote
// lines and inline double-quoted runs. Short quotes (<25 normalized chars) are
// skipped — too likely to be incidental phrasing, not a verbatim claim.
import { MD_LINK_SRC } from "./citation-links.ts";
import { normalizeForMatch } from "./match-normalize.ts";
import { ABSENCE, isAttributionLine, isSelfAuthoredCallout, isSelfAuthorshipLeadIn } from "./quote-lead-in.ts";

// Attribution is authoring, not quotation: models routinely close a blockquote
// with "— [Title](/atlas/…)", so a trailing dash-led citation is cut and any
// remaining markdown link collapses to its text before matching.
function stripQuoteDecoration(span: string): string {
  return span
    // Trailing attribution, optionally followed by a doc_no: `— [Title](/atlas/x) (A.1.2.3)`
    .replace(new RegExp(String.raw`\s*[—–-]{1,2}\s*` + MD_LINK_SRC + String.raw`\s*(?:\([^)]*\))?\s*$`), "")
    .replace(new RegExp(MD_LINK_SRC, "g"), "$1");
}

// A quoted TERM the answer denies is a mention, not a quotation: `the atlas
// does not contain an organization called "X"`. Such a term can never appear
// in the evidence — its absence IS the claim — so demanding grounding fires
// exactly when the model does the most honest thing available. Kept narrow: a
// denial must sit within 40 chars of the quote with no clause break, and only
// term-length spans qualify, so a long passage is always checked even under a
// negation. The denial may sit before the quote or after it, but must be in
// the same clause (no sentence/clause break between).
const DENIAL_BEFORE = new RegExp(ABSENCE + String.raw`[^.!?;:]{0,40}$`, "i");
const DENIAL_AFTER = new RegExp(String.raw`^[^.!?;:]{0,80}?` + ABSENCE, "i");
const MAX_DENIED_TERM = 60;

interface QuotedPair {
  text: string;
  start: number;
  end: number;
}

// Quote characters pair in document order: 1st opens, 2nd closes, 3rd opens…
// Extracting with a single regex desyncs that pairing whenever a span is
// skipped (a short term like "Delegate"), so the scan then captures the PROSE
// BETWEEN two quoted terms as if it were quoted text. Pair first, filter after.
function quotedPairs(line: string): QuotedPair[] {
  const marks: number[] = [];
  for (let i = 0; i < line.length; i++) if (line[i] === '"' || line[i] === "“" || line[i] === "”") marks.push(i);
  const out: QuotedPair[] = [];
  for (let i = 0; i + 1 < marks.length; i += 2) {
    out.push({ text: line.slice(marks[i] + 1, marks[i + 1]), start: marks[i], end: marks[i + 1] });
  }
  return out;
}

// A citation the model hung on the END of a blockquote line — one or more
// `[text](/atlas/<uuid>)` links, or a bare uuid — is attribution, not quoted
// text. Left in, the span ends with the link text or the id and can never match
// the source, so a verbatim quote with `[<uuid>](/atlas/<uuid>)` appended would
// hard-fail. Only the TAIL is stripped: a link mid-sentence may be part of the
// quoted atlas text itself (atlas docs contain inline links) and still
// collapses to its text.
const TRAILING_CITATIONS = /(?:\s*(?:\[[^\]]+\]\([^)\s]+\)|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))+\s*[.,;:]?\s*$/i;

// `leadInSeed` is the lead-in already in force when this text begins — used by
// the incremental pass, which checks ONE paragraph at a time and would otherwise
// never see the line that introduced a blockquote (the lead-in and the block are
// separate paragraphs, so they never arrive together). Without it the streaming
// `paragraph_check` would report a callout the final whole-answer pass clears,
// and the user would watch a finding appear and then vanish.
export interface QuotedSpan {
  /** Normalized span text — the key every grounding check matches on. */
  text: string;
  /**
   * The line that introduced it: the last non-empty line above a blockquote
   * block, or the prose before an inline quote's opening mark. This is where
   * attribution is actually declared, so it is what decides whether an
   * ungrounded span is a deterministic failure or a question for a model.
   */
  leadIn: string;
}

function blockquoteSpans(answer: string, leadInSeed: string): QuotedSpan[] {
  const spans: QuotedSpan[] = [];
  // `leadIn` is the last non-empty line ABOVE the current blockquote block. A
  // blockquote line never updates it, so every line of a multi-line block shares
  // the one lead-in that introduced the block, and a blank line between the two
  // does not clear it.
  let leadIn = leadInSeed;
  for (const line of answer.split("\n")) {
    const bq = line.match(/^\s*>\s?(.+)$/);
    if (!bq) {
      if (line.trim()) leadIn = line;
      continue;
    }
    if (!isAttributionLine(bq[1]) && !isSelfAuthoredCallout(bq[1]) && !isSelfAuthorshipLeadIn(leadIn)) {
      // The lead-in is the line ABOVE, and ONLY that. Appending the quoted line
      // would let ASSERTION_VERB match words inside the span — a self-authored
      // callout containing `required` plus a citation would become tier A, a
      // deterministic hard failure that never reaches the model. A trailing
      // `— [Title](/atlas/…)` on the block line is handled by isAttributionLine
      // and TRAILING_CITATIONS; it is a citation without an assertion, which
      // quote-lead-in.ts's own rule makes tier B anyway.
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
  // A quoted QUESTION is something the assistant is inviting the reader to
  // ask, never a passage copied out of a rule document. Measured against
  // the served atlas: 0 of 11,340 documents contain a quoted question of
  // this length, so excluding them removes no real detection. An orientation
  // answer ending "You can ask things like:" plus example questions would
  // otherwise hard-fail on every one of them.
  if (/\?["”']*\s*$/.test(q.text.trim())) return true;
  // A list item whose ENTIRE content is one quoted string is an example or
  // a suggestion, not an inline quotation. Real verbatim atlas text is a
  // `>` blockquote (the system prompt reserves them for exactly that) or
  // sits inside prose with an attribution — either way the line carries
  // more than the quote itself.
  return /^\s*[-*+]\s*$/.test(beforeQuote) && /^[.?!,;:]*\s*$/.test(afterQuote);
}

function inlineSpans(answer: string): QuotedSpan[] {
  const spans: QuotedSpan[] = [];
  // Collapse markdown links to their text FIRST — a quote inside one link's
  // title otherwise pairs with the quote in the next link's title, capturing
  // the href and prose between them as a phantom "quote". Scanned per line
  // because a real inline quotation never spans lines.
  const flat = answer.replace(new RegExp(MD_LINK_SRC, "g"), "$1");
  for (const line of flat.split("\n")) {
    for (const q of quotedPairs(line)) {
      if (isExemptInlineQuote(q, line)) continue;
      // For an inline quote the lead-in is the prose BEFORE it on the same line
      // (`The document states "…"`). What follows is deliberately excluded, for
      // the same reason as the blockquote lead-in: `My own summary: "…" — which
      // requires [A.2.1](/atlas/…)` is the opposite of an attribution, and
      // reading the tail would class it tier A.
      spans.push({ text: q.text, leadIn: line.slice(0, q.start) });
    }
  }
  return spans;
}

export function extractQuotedSpanRecords(answer: string, leadInSeed = ""): QuotedSpan[] {
  // Dedupe on normalized text, keeping the FIRST occurrence's lead-in: a span
  // repeated verbatim is one quotation, and the first place it appears is where
  // the author said what it was.
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
