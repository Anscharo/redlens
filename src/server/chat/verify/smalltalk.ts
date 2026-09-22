// The deterministic half of the small-talk bypass (chat-orchestrator.ts); the
// judged half is verify/smalltalk-jev.ts. This file is pure code — no model,
// no network — and gates BOTH the question (does it even reach the judge?)
// and the answer (is there anything here worth auditing?).
//
// The MODEL judges whether a message needed the atlas — the system prompt
// tells it plain conversation gets a brief, tool-free reply, and the router
// never makes pre-flight model calls — so the only safe code-side question
// is: does the answer it wrote contain anything the harness could check?
// Any groundable marker (doc numbers, links — markdown or bare autolink —
// reference labels, addresses, or any figure at all) fails the test and
// keeps the full audit: a zero-tool answer that cites or quantifies is
// exactly the hallucination case the verifier exists for. Erring toward
// auditing costs seconds; erring toward bypassing costs trust — so every
// pattern here is loose.
const GROUNDABLE_RES: RegExp[] = [
  /\b[A-Z]{1,3}(?:\.\d+)+\b/, // doc_no shape (signal only — never a lookup key)
  /[0-9a-f]{8}-[0-9a-f]{4}/i, // uuid fragment
  /\/atlas\//, // in-app atlas link
  /\]\(/, // any markdown link
  /\bhttps?:\/\/[^\s)]+/i, // bare autolink — `](` misses https://sky.money with no digits
  /\[[^\]\s]+\]/, // reference-style citation label
  /0x[0-9a-fA-F]{4,}/, // evm address-ish
  /\d/, // any figure — numbers are the verifier's business
  /[{}`]/, // braces/backticks — leaked entity slugs and code spans get repaired, not bypassed
];

// Small talk is short. A reply this long is explaining something, and
// explanations get audited.
export const SMALLTALK_MAX_CHARS = 600;

export function isUncheckableAnswer(content: string): boolean {
  if (content.length > SMALLTALK_MAX_CHARS) return false;
  return !GROUNDABLE_RES.some((re) => re.test(content));
}
