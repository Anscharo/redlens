// Paraphrase templates for the retrieval eval's queries.
//
// WHY THIS EXISTS. Until 2026-08-18 the query set was built by concatenating the
// target's own strings — `${instance} ${paramName} ${paramValue}` — which made 39 of
// 40 icd-param queries contain the answer verbatim, and made the whole set a test of
// lexical matching that BM25 already wins. A semantic ranker only earns its keep when
// the question is worded DIFFERENTLY from the document, so every template here is
// written to share nothing with the target but the entity name.
//
// The entity name is deliberate, not leakage: a real person naming the thing they are
// asking about is the realistic case. What must never appear is the field label or the
// value. "Network" becomes "which chain … runs on"; "Required Number Of Signers"
// becomes "how many approvals … need".
//
// A param with no template here is SKIPPED rather than falling back to its raw name —
// a fallback would silently reintroduce the field label and undo the point. Breadth
// comes from covering many instances, not from covering every field.
//
// eval-retrieval.ts measures rare-token overlap between each query and its target and
// prints it per slice, so a regression here surfaces immediately instead of hiding for
// several evaluation rounds (which is exactly what happened).

export type Paraphrase = (subject: string) => string;

// Ordered: first match wins, so put specific patterns before general ones
// ("underlying asset address" before "address").
export const PARAM_PARAPHRASES: Array<[RegExp, Paraphrase]> = [
  [/^network$/i, (s) => `which chain does ${s} run on`],
  [/^target protocol$/i, (s) => `what protocol does ${s} integrate with`],
  [/^token$/i, (s) => `what asset does ${s} use`],
  [/^token address$/i, (s) => `contract for the asset ${s} issues`],
  [/underlying asset address$/i, (s) => `what token contract backs ${s}`],
  [/^pool address$/i, (s) => `where is the ${s} pool deployed`],
  [/rate limit ids?$/i, (s) => `how are transfer limits identified for ${s}`],
  [/^reward code$/i, (s) => `what code identifies rewards for ${s}`],
  // Direction-aware BEFORE the generic forms: inflow and outflow both end in
  // maxAmount/slope, and collapsing them onto one phrasing produced two identical
  // questions with different correct answers — unanswerable, and silently scored.
  [/inflow.*maxamount$/i, (s) => `what is the cap on how much can flow into ${s}`],
  [/outflow.*maxamount$/i, (s) => `what is the cap on how much can leave ${s}`],
  [/inflow.*slope$/i, (s) => `how quickly does ${s} recover its incoming allowance`],
  [/outflow.*slope$/i, (s) => `how quickly does ${s} recover its outgoing allowance`],
  [/maxamount$/i, (s) => `what is the ceiling on how much ${s} can move`],
  [/slope$/i, (s) => `how quickly does ${s} replenish its allowance`],
  [/^timelock$/i, (s) => `how long is the delay before changes take effect for ${s}`],
  [/curator role address$/i, (s) => `who curates ${s}`],
  [/guardian role address$/i, (s) => `who guards ${s}`],
  [/^default admin/i, (s) => `who has top-level control over ${s}`],
  [/asset supplied by/i, (s) => `what does the liquidity layer put into ${s}`],
  [/^required number of signers$/i, (s) => `how many approvals does ${s} need`],
  [/^signers$/i, (s) => `who controls ${s}`],
  [/^modification$/i, (s) => `who is allowed to swap out the people behind ${s}`],
  [/^usage standards$/i, (s) => `what are people permitted to do with ${s}`],
  [/^address$/i, (s) => `where is ${s} deployed`],
  [/^duration/i, (s) => `how long does ${s} last`],
  [/^parties/i, (s) => `who entered into ${s}`],
  [/^global activation status$/i, (s) => `is ${s} live yet`],
];

export function paraphraseFor(paramName: string): Paraphrase | null {
  for (const [re, fn] of PARAM_PARAPHRASES) if (re.test(paramName)) return fn;
  return null;
}

// Words a query may share with its target without counting as leakage: they carry no
// retrieval signal on their own.
const STOPWORDS = new Set([
  "what", "which", "does", "the", "for", "how", "who", "is", "are", "do", "on", "in",
  "of", "to", "and", "a", "an", "its", "it", "can", "with", "before", "long", "much",
  "many", "there", "that", "this", "put", "into", "out", "yet", "was", "were", "run",
]);

export function contentTokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((t) => !STOPWORDS.has(t));
}

// Fraction of a query's content tokens that also occur in the target text. 1.0 means
// the query is a substring-ish restatement of the document (a lexical test); low
// values mean the ranker has to bridge the wording gap. Reported per slice so the
// failure mode that produced the old query set can never go unnoticed again.
export function lexicalOverlap(query: string, targetText: string): number {
  const q = contentTokens(query);
  if (q.length === 0) return 0;
  const t = new Set(contentTokens(targetText));
  let hit = 0;
  for (const w of q) if (t.has(w)) hit++;
  return hit / q.length;
}
