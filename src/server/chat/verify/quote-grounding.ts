// Quote grounding: every verbatim-quoted span must occur in the turn's
// evidence, in a cited document, or in an atlas title.
import type { Indexes } from "../../retrieval/indexes.ts";
import { extractCitations } from "./citation-links.ts";
import { normalizeForMatch } from "./match-normalize.ts";
import { isAttributedLeadIn } from "./quote-lead-in.ts";
import { extractQuotedSpanRecords, type QuotedSpan } from "./quote-spans.ts";

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

// Normalized atlas titles, cached per index. A quoted TITLE is atlas text even
// when this turn never retrieved the document: page context and earlier turns
// hand the model the title (and it quotes that, often with only a parenthetical
// doc number). Bodies stay out of this list — an invented passage that happens
// to exist somewhere unretrieved must still fail.
const titleHaystacks = new WeakMap<Indexes, string[]>();

function atlasTitles(ix: Indexes): string[] {
  const cached = titleHaystacks.get(ix);
  if (cached) return cached;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const doc of ix.docMap.values()) {
    const t = normalizeForMatch(doc.title);
    // Shorter than a checked segment, so it can never ground one.
    if (t.length < 12 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  titleHaystacks.set(ix, out);
  return out;
}

// What a quote may be grounded in: the turn's tool-result evidence, the
// title/content of any doc the answer cites, and every atlas title.
function quoteHaystacks(answer: string, evidenceTexts: string[], ix: Indexes): string[] {
  return [
    ...evidenceTexts.map(normalizeForMatch),
    ...extractCitations(answer).map((c) => {
      const doc = ix.docMap.get(c.uuid);
      return normalizeForMatch(doc ? `${doc.title}\n${doc.content}` : "");
    }),
    ...atlasTitles(ix),
  ];
}

// A quote is grounded if every verifiable segment appears in the turn's
// tool-result evidence, in the title/content of any doc the answer cites, or
// is itself (part of) an atlas document title.
export function findUngroundedQuotes(
  answer: string,
  evidenceTexts: string[],
  ix: Indexes,
  question?: string,
  leadInSeed?: string,
): string[] {
  return findUngroundedQuoteSpans(answer, evidenceTexts, ix, question, leadInSeed).map((s) => s.text);
}

/**
 * The same scan, keeping each ungrounded span's lead-in so the caller can tier
 * it. `attributed` is tier A (see isAttributedLeadIn): a deterministic hard
 * failure. The rest are tier B — candidates for the Jev attribution lane, which
 * decides whether the answer was presenting them as source text at all.
 */
export function findUngroundedQuoteSpans(
  answer: string,
  evidenceTexts: string[],
  ix: Indexes,
  question?: string,
  leadInSeed?: string,
): (QuotedSpan & { attributed: boolean })[] {
  // A quoted span that the USER wrote — the answer echoing the question's own
  // term ("…specifically for \"Operational Facilitators.\"") — is a scare quote,
  // not a passage copied from a rule document.
  const q = question ? normalizeForMatch(question) : "";
  const bare = (s: string) => s.replace(/^[\s"',.;:!?()—–-]+|[\s"',.;:!?()—–-]+$/g, "");
  const spans = extractQuotedSpanRecords(answer, leadInSeed).filter((s) => !(q && q.includes(bare(s.text))));
  if (spans.length === 0) return [];
  const haystacks = quoteHaystacks(answer, evidenceTexts, ix);
  return spans
    .filter((s) => quoteSegments(s.text).some((seg) => !haystacks.some((h) => h.includes(seg))))
    .map((s) => ({ ...s, attributed: isAttributedLeadIn(s.leadIn) }));
}
