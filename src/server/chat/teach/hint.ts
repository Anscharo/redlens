// Backstop: if the assistant's answer reads as "I couldn't find this" and it
// never mentioned /teach, append the invitation. The system prompt already
// asks the model to write this itself (naming X); this is for when it forgets.
//
// Applied after deterministic repair and before `answer_final`, so history,
// the client, and the persisted message all carry the same text. The hint is
// app UI copy, not an atlas claim.

export const TEACH_HINT =
  "If I should have known this, use `/teach` to teach me what it is so this mistake is not made again.";

// Honest-miss phrasings. Broad on purpose: the cost of a false fire is one
// extra sentence on an answer that already declined, and the cost of a miss
// is the user never learning `/teach` exists.
const MISS_RE =
  /could(?:n['’]t| not) find|unable to (?:find|locate)|does not (?:appear to )?(?:exist|cover)|doesn['’]t (?:appear to )?(?:exist|cover)|not (?:in|found in|covered by|recorded in) the atlas|atlas (?:does not|doesn['’]t) (?:cover|mention|record|identify|contain|specify)|no (?:document|result|mention) (?:in the atlas|naming|matching)|nothing in the atlas|i (?:was not|wasn['’]t) able to find|i (?:do not|don['’]t) (?:see|have) (?:a |any |that )/i;

export function looksLikeMiss(answer: string): boolean {
  const text = answer.trim();
  if (text.length < 24) return false;
  return MISS_RE.test(text);
}

export function withTeachHint(answer: string): string {
  if (!looksLikeMiss(answer)) return answer;
  if (/\/teach\b/i.test(answer)) return answer;
  const trimmed = answer.replace(/\s+$/, "");
  const sep = trimmed.endsWith(".") || trimmed.endsWith("?") || trimmed.endsWith("!") ? " " : ". ";
  return `${trimmed}${sep}${TEACH_HINT}`;
}
