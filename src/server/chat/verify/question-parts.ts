// Splits a user question into the parts an answer has to address, in CODE —
// the "did it answer the question?" check (answer-coverage.ts) then asks Jev
// one narrow Noul per part, so a dropped part can be NAMED rather than merely
// scored. Decomposition in code, judgment in Jev (docs/plans/jev-typesafe.md
// §A2).
//
// The rule is deliberately conservative: a false split turns one question
// into two half-questions, and each half then reads as "not addressed" by an
// answer that addressed the whole. Measured 2026-09-22: 87% of real user
// messages (176 of 203, dev DB, counts only) come out as ONE part.
//
// 1. Sentences: split after `?` or `;`, or after `.`/`!` followed by
//    whitespace + a capital letter. Not after a common abbreviation
//    (`e.g.`, `i.e.`, `vs.`, `etc.`, `Mr.`, `Dr.`): a false split names a
//    fragment the coverage line then says the answer didn't address. A missed
//    split stays one part, which says nothing.
// 2. Within a sentence, split at `, ` / `, and ` / `, or ` / ` and ` / ` or `
//    ONLY when the next word is a wh-word (what which who whom whose when
//    where why how whether); at `, and ` / `, or ` when the next word is an
//    auxiliary (is are was were does do did can could has have should will
//    would); and at `, ` when a preposition + wh-word follows (", for which
//    chains"). Noun conjunctions ("Redline and Soter", "signer counts and
//    thresholds") never split.
// 3. Trim, drop trailing punctuation, drop empty parts.
const WH = "what|which|who|whom|whose|when|where|why|how|whether";
const AUX = "is|are|was|were|does|do|did|can|could|has|have|should|will|would";
const PREP = "for|in|on|at|by|to|from|with|since";
// The match is the whitespace AFTER the punctuation (lookbehind). A fresh
// regex per call: a shared /g keeps lastIndex.
const sentenceRe = () => /(?<=[?;])\s+|(?<=[.!])\s+(?=[A-Z])/g;
// The characters immediately before that whitespace. `e.g.` / `i.e.` must not
// open a new sentence; a missed split stays one part, which says nothing.
const ABBREV_BEFORE = /(?:^|[\s,(])(?:e\.g|i\.e|vs|etc|mr|mrs|ms|dr)\.$/i;
const CLAUSE_RE = new RegExp(
  `(?:,\\s*(?:and|or)\\s+|,\\s+|\\s+(?:and|or)\\s+)(?=(?:${WH})\\b)` +
    `|,\\s*(?:and|or)\\s+(?=(?:${AUX})\\b)` +
    `|,\\s+(?=(?:${PREP})\\s+(?:${WH})\\b)`,
  "i",
);

/** Sentences, keeping an abbreviation's period attached to its own sentence. */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const m of text.matchAll(sentenceRe())) {
    const punct = text[m.index - 1];
    if (punct !== "?" && punct !== ";" && ABBREV_BEFORE.test(text.slice(0, m.index))) continue;
    out.push(text.slice(start, m.index));
    start = m.index + m[0].length;
  }
  out.push(text.slice(start));
  return out;
}

export function splitQuestionParts(question: string): string[] {
  const out: string[] = [];
  for (const sentence of splitSentences(question.trim())) {
    for (const clause of sentence.split(CLAUSE_RE)) {
      const part = clause.trim().replace(/[?.;!\s]+$/, "").trim();
      if (part) out.push(part);
    }
  }
  return out;
}
