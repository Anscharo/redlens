// Whether a quoted line, or the lead-in that introduces it, presents the text
// as atlas source. These classifiers decide which spans quote-spans.ts keeps
// and which kept spans are tier A (a deterministic hard failure when
// ungrounded) rather than tier B (a question for verify/quote-attribution.ts).
import { DOC_NO_CORE } from "../../../lib/patterns.ts";

// A blockquote line that is ONLY an attribution — `— [Title](/atlas/uuid) (A.1.2.3)`
// or `— Distribution Reward Rate (A.2.2.9.1.2.1.2)` — is the author crediting a
// source, not quoting it. Left unhandled it flags as invented atlas text, which
// punishes the models that attribute most rigorously. Requires BOTH a leading
// attribution dash and a citation marker (link or doc_no), so a quoted list item
// like `> - item one` is still treated as quoted content.
const ATTRIBUTION_DASH = /^\s*[—–-]{1,2}\s*\S/;
const CITATION_MARKER = new RegExp(String.raw`\[[^\]]*\]\([^)]*\)|\b` + DOC_NO_CORE + String.raw`\b`);
export const isAttributionLine = (line: string) => ATTRIBUTION_DASH.test(line) && CITATION_MARKER.test(line);

// A blockquote line the model wrote ABOUT the material rather than FROM it —
// `> **Bottom line: …**`. Models routinely render their own summary as a bolded
// blockquote callout, and a self-authored callout can never appear in the
// evidence, so scoring it as a quotation hard-fails otherwise honest answers.
// The discriminator is a CONJUNCTION, deliberately: essentially the whole line
// is bold AND it carries no quotation marks AND no citation link. Either of
// those two markers means the model is presenting the line as source text
// (`> **"…"**`, or a bolded quote closed by its attribution), so a genuine
// invented quote is still caught. The system prompt reserves blockquotes for
// verbatim quotation, which is the other half of this rule.
const BOLD_RUN = /\*\*([^*]+)\*\*/g;
const MD_LINK_ANY = /\[[^\]]*\]\([^)]*\)/;
const BOLD_LINE_MIN = 0.9;

export function isSelfAuthoredCallout(line: string): boolean {
  if (/["“”]/.test(line) || MD_LINK_ANY.test(line)) return false;
  const plain = line.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  if (plain.length === 0) return false;
  let bold = 0;
  for (const m of line.matchAll(BOLD_RUN)) bold += m[1].replace(/\s+/g, " ").trim().length;
  return bold / plain.length >= BOLD_LINE_MIN;
}

// The same callout, introduced in PLAIN PROSE. `isSelfAuthoredCallout` reads the
// quoted line itself and needs it to be ~entirely bold, which is the narrower
// half of the convention: models just as often write `The practical lesson is:`
// and then put an unbolded one-sentence synthesis in a blockquote
// ("The practical lesson is:", "But it has an important practical consequence:",
// "The central conclusion is:"). Scored as quotations, those hard-fail an answer
// no reader would take as quoting.
//
// The discriminator is the LEAD-IN, not the quoted line: a lead-in whose subject
// is the answer or the reader rather than a document says the author is about to
// speak for themselves. It is a closed list, and it is a CONJUNCTION with "no
// citation in the lead-in" — once the author names a source they are attributing,
// so `Per [X](/atlas/…), the central conclusion is:` stays checked.
const SELF_AUTHORSHIP_LEAD =
  /\b(?:practical\s+(?:lesson|consequence|implication)|central\s+(?:conclusion|point)|bottom\s+line|key\s+takeaway|takeaway|upshot|net\s+effect|in\s+short|in\s+summary|to\s+summari[sz]e|my\s+read|what\s+this\s+means|the\s+(?:net|overall)\s+picture)\b/i;

// Absence markers: the answer asserting the quoted thing does NOT exist. The
// verbs are deliberately specific — a bare "not" would excuse a real invented
// quote in any ordinary negated sentence ("this is not a hypothetical: the doc
// states \"…\"").
const ABSENCE_VERB = "contain|mention|define|include|specify|list|name|exist|appear|say|state|address|cover|prescribe|prohibit|document|record|refer";
// Exported for absence.ts: the subject of an absence claim is what's LEFT once
// the denial phrase is removed, so the two must agree on what a denial is.
export const ABSENCE = String.raw`(?:(?:does|do|did|is|are|was|were)\s+not\s+\w*\s*(?:${ABSENCE_VERB})|(?:does|do|did|is|are|was|were)n't\s+\w*\s*(?:${ABSENCE_VERB})|there\s+(?:is|are)\s+no\b|no such\b|nowhere\b|(?:is|are)\s+silent|not\s+(?:available|specified|stated|covered|addressed|found|mentioned|defined|documented)|lacks?\b|lacking\b|absent\b|never\s+\w*\s*(?:${ABSENCE_VERB})s?)`;

// Deliberately NOT ABSENCE_VERB un-negated. Negation changes which verbs are
// diagnostic: `does not cover` is a clean denial, but `covers` describes a
// document TOPICALLY and says nothing about the text below it being in it — the
// very use-vs-mention distinction this tier is supposed to get right. Same for
// `mentions`, `addresses`, `refers to`, `names`, `appears`, `includes`. So the
// containment verbs are listed explicitly here, and the list is kept NARROW on
// purpose: tier A is the only route to a code-only hard failure, so a false
// positive here is a red badge on an honest answer, while a miss merely sends
// the span to the model instead.
const ASSERTION_VERB =
  /\b(?:states?|stated|says?|said|reads?|defines?|defined|specifies|specified|prescribes?|prescribed|prohibits?|prohibited|requires?|required|lists?|listed|notes?|noted|declares?|declared|provides?|provided|sets? out|puts? it|according to|per|verbatim|quot(?:e|es|ed|ing))\b/i;
const ABSENCE_TEST = new RegExp(ABSENCE, "i");

/**
 * Tier A — the lead-in BOTH names a source and asserts that it says this.
 *
 * This is the only half of "is the answer claiming to quote?" that code can
 * settle: `[Title](/atlas/<uuid>) states:` is unambiguous, needs no language
 * judgement, and works with no model configured. Naming a document is NOT
 * enough on its own — `A.1.7.1 covers Operational Facilitators` describes a doc,
 * `A.1.7.1 states:` asserts its contents, and only the second makes the text
 * below a quotation (ASSERTION_VERB's comment has why that distinction cannot
 * reuse the absence-verb list). A negated lead-in ("the atlas does not state")
 * is an absence claim, not an attribution, so it is excluded.
 *
 * Everything else ungrounded is tier B: a real question about use vs mention,
 * which is a model's job (verify/quote-attribution.ts).
 */
export function isAttributedLeadIn(leadIn: string): boolean {
  return CITATION_MARKER.test(leadIn) && ASSERTION_VERB.test(leadIn) && !ABSENCE_TEST.test(leadIn);
}

/**
 * The phrase has to INTRODUCE the quote, not merely appear somewhere in the
 * lead-in — which can be a whole paragraph tail. Matching anywhere would let
 * "My read of the rewards section is that it is mostly settled. Turning to
 * seizure, the document is explicit:" exempt a quote the second clause plainly
 * attributes. So only the LAST clause is read.
 *
 * And it is a three-way conjunction: an ASSERTION_VERB anywhere in the lead-in
 * defeats the exemption outright. Without that, "The atlas text, in short,
 * reads:" would drop a fabricated quote from grounding ENTIRELY — the exemption
 * removes the span before it is ever checked, so a hole here is a fabricated
 * quote passing, not merely a tier misassignment.
 */
export function isSelfAuthorshipLeadIn(leadIn: string): boolean {
  const lastClause = leadIn.split(/[.!?;]\s|\n/).filter((c) => c.trim()).at(-1) ?? "";
  return (
    SELF_AUTHORSHIP_LEAD.test(lastClause) &&
    !CITATION_MARKER.test(leadIn) &&
    !ASSERTION_VERB.test(leadIn)
  );
}
