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
//    whitespace + a capital letter.
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
const SENTENCE_RE = /(?<=[?;])\s+|(?<=[.!])\s+(?=[A-Z])/;
const CLAUSE_RE = new RegExp(
  `(?:,\\s*(?:and|or)\\s+|,\\s+|\\s+(?:and|or)\\s+)(?=(?:${WH})\\b)` +
    `|,\\s*(?:and|or)\\s+(?=(?:${AUX})\\b)` +
    `|,\\s+(?=(?:${PREP})\\s+(?:${WH})\\b)`,
  "i",
);

export function splitQuestionParts(question: string): string[] {
  const out: string[] = [];
  for (const sentence of question.trim().split(SENTENCE_RE)) {
    for (const clause of sentence.split(CLAUSE_RE)) {
      const part = clause.trim().replace(/[?.;!\s]+$/, "").trim();
      if (part) out.push(part);
    }
  }
  return out;
}
