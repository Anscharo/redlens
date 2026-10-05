// Claim units of an answer, and the "distinctive words" vocabulary that tells
// a claim from a bare citation. Shared by cite-pairs.ts, refute-screen.ts,
// refute-screen-evidence.ts and absence.ts so they agree on what a claim is.
import { extractCitations, MD_LINK_SRC } from "./citation-links.ts";

// "Distinctive words" — lowercased, stopwords out, plurals folded. Used by
// claimSegments' citation-only test and by absence.ts.
const MD_LINKS = new RegExp(MD_LINK_SRC, "g");
const OVERLAP_STOPWORDS = new Set(
  ("the and are was were for from with without into over under about that this these those which who whom whose " +
    "what when where why how all any both each few more most other some such only own same too very per also " +
    "within across between during after before above below out off again further once its their his her they " +
    "them you your our not nor but then than there here can could may might must shall should will would has " +
    "have had having does did done being been").split(" "),
);
// Plural/possessive folding so `facilitators` matches `Facilitator`. Crude on
// purpose: callers compare sets of many words, not parse.
const foldWord = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

// Exported for absence.ts, which scopes an absence claim to the evidence that
// is ABOUT it, using this one "distinctive words only" notion of aboutness.
export function contentWords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  return [...new Set(words.filter((w) => !OVERLAP_STOPWORDS.has(w)).map(foldWord))];
}

// A segment carrying citations but no prose of its own — `[Title](/atlas/…)`
// sitting after a sentence's period, or an attribution line. It is an
// attachment to the sentence before it, not a claim in its own right.
const isCitationOnly = (seg: string): boolean =>
  extractCitations(seg).length > 0 && contentWords(seg.replace(MD_LINKS, " ")).length === 0;

// Claim units: one line of markdown, split further at sentence ends. A citation
// belongs to the sentence it closes, not to the whole paragraph.
//
// Splitting at sentence ends alone loses every trailing citation: `Foo is bar.
// [Doc](/atlas/x)` becomes a prose segment with no citation (nothing to check)
// plus a citation segment with no prose (too few words to be a claim), so the
// claim escapes from both sides. Since the system prompt asks for exactly that
// shape ("Quote at most 1–2 sentences … always followed by its link"), a
// citation-only segment is folded back onto the sentence it follows.
export function claimSegments(answer: string): string[] {
  const out: string[] = [];
  for (const line of answer.split("\n")) {
    // Headings carry no claim; blockquotes (content AND their attribution line)
    // are skipped because findUngroundedQuotes already checks quoted text against
    // the cited doc's content — checking them here too would double-report the
    // same misattribution.
    if (/^\s*(?:#{1,6}\s|>)/.test(line)) continue;
    const segs = line.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      // Same-line trailing citation, or an em/en-dash attribution on its own
      // line. A plain `-` lead is deliberately NOT folded: that is a markdown
      // bullet, and a trailing source LIST would otherwise be scored against
      // the last sentence of the prose above it — every entry a false flag.
      const attaches = i > 0 || /^\s*[—–]/.test(seg);
      if (isCitationOnly(seg) && attaches && out.length > 0) {
        out[out.length - 1] += ` ${seg}`;
        continue;
      }
      out.push(seg);
    }
  }
  return out;
}
