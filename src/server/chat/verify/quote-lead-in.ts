// Classifies whether a quoted line or its lead-in presents text as atlas
// source: which spans quote-spans.ts keeps, and which are tier A vs tier B.
import { DOC_NO_CORE } from "../../../lib/patterns.ts";

// An attribution-only line (`— [Title](/atlas/uuid)`) credits a source rather
// than quoting it. Needs BOTH dash and citation, so `> - item one` stays quoted.
const ATTRIBUTION_DASH = /^\s*[—–-]{1,2}\s*\S/;
const CITATION_MARKER = new RegExp(String.raw`\[[^\]]*\]\([^)]*\)|\b` + DOC_NO_CORE + String.raw`\b`);
export const isAttributionLine = (line: string) => ATTRIBUTION_DASH.test(line) && CITATION_MARKER.test(line);

// A bolded callout the model wrote ABOUT the material (`> **Bottom line: …**`).
// A conjunction: ~all bold AND no quotation marks AND no link, since either
// marker presents the line as source text and must still be checked.
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

// The same callout introduced in plain prose (`The practical lesson is:`),
// detected from the LEAD-IN. A closed list; see isSelfAuthorshipLeadIn.
const SELF_AUTHORSHIP_LEAD =
  /\b(?:practical\s+(?:lesson|consequence|implication)|central\s+(?:conclusion|point)|bottom\s+line|key\s+takeaway|takeaway|upshot|net\s+effect|in\s+short|in\s+summary|to\s+summari[sz]e|my\s+read|what\s+this\s+means|the\s+(?:net|overall)\s+picture)\b/i;

// Absence markers. Specific verbs, since a bare "not" would excuse an invented
// quote in any negated sentence.
const ABSENCE_VERB = "contain|mention|define|include|specify|list|name|exist|appear|say|state|address|cover|prescribe|prohibit|document|record|refer";
// Exported for absence.ts: the subject of an absence claim is what's LEFT once
// the denial phrase is removed, so the two must agree on what a denial is.
export const ABSENCE = String.raw`(?:(?:does|do|did|is|are|was|were)\s+not\s+\w*\s*(?:${ABSENCE_VERB})|(?:does|do|did|is|are|was|were)n't\s+\w*\s*(?:${ABSENCE_VERB})|there\s+(?:is|are)\s+no\b|no such\b|nowhere\b|(?:is|are)\s+silent|not\s+(?:available|specified|stated|covered|addressed|found|mentioned|defined|documented)|lacks?\b|lacking\b|absent\b|never\s+\w*\s*(?:${ABSENCE_VERB})s?)`;

// Not ABSENCE_VERB un-negated: `covers` describes a doc topically, it does not
// assert its text. Kept NARROW: a false positive here is a code-only hard
// failure, while a miss only sends the span to the model.
const ASSERTION_VERB =
  /\b(?:states?|stated|says?|said|reads?|defines?|defined|specifies|specified|prescribes?|prescribed|prohibits?|prohibited|requires?|required|lists?|listed|notes?|noted|declares?|declared|provides?|provided|sets? out|puts? it|according to|per|verbatim|quot(?:e|es|ed|ing))\b/i;
const ABSENCE_TEST = new RegExp(ABSENCE, "i");

/**
 * Tier A: the lead-in both names a source and asserts it says this
 * (`A.1.7.1 states:`), and is not negated. Everything else ungrounded is
 * tier B, a model's job (verify/quote-attribution.ts).
 */
export function isAttributedLeadIn(leadIn: string): boolean {
  return CITATION_MARKER.test(leadIn) && ASSERTION_VERB.test(leadIn) && !ABSENCE_TEST.test(leadIn);
}

/**
 * Only the LAST clause is read: the phrase must introduce the quote. Any
 * citation or ASSERTION_VERB in the lead-in defeats the exemption, because an
 * exempt span is never checked at all ("The atlas text, in short, reads:").
 */
export function isSelfAuthorshipLeadIn(leadIn: string): boolean {
  const lastClause = leadIn.split(/[.!?;]\s|\n/).filter((c) => c.trim()).at(-1) ?? "";
  return (
    SELF_AUTHORSHIP_LEAD.test(lastClause) &&
    !CITATION_MARKER.test(leadIn) &&
    !ASSERTION_VERB.test(leadIn)
  );
}
