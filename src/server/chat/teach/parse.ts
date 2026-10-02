// /teach command parser. The rest of the message is the teaching; an empty
// body is still a command (the handler replies with usage help).
//
// Must be at the start of the message (leading whitespace allowed) so a
// sentence that mentions "/teach" mid-thought is still a normal question.

// Hard cap, in WORDS, set by the on-device embedder: ternlight reads 128
// tokens and then stops. Plain prose is ~1.24 tokens/word and atlas jargon
// ~1.82 (measured 2026-09-16), so 60 words plus the review's short subject
// title stays inside the window even on the densest note. The QUALITY advice
// is stricter than the cap — one fact per note, a sentence or two — because a
// second unrelated fact roughly halves a note's semantic match (0.48 → 0.30 on
// a real note) long before any truncation. The handler rejects over the cap
// with the count rather than truncating silently.
export const TEACH_MAX_WORDS = 60;

export function countTeachingWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const TEACH_RE = /^\s*\/teach(?:\s+|$)/i;

export interface TeachCommand {
  /** Trimmed teaching body. Empty means the user sent `/teach` alone. */
  text: string;
}

export function parseTeachCommand(message: string): TeachCommand | null {
  if (!TEACH_RE.test(message)) return null;
  return { text: message.replace(TEACH_RE, "").trim() };
}

export const TEACH_LENGTH_RULE =
  `One fact per note, a sentence or two (under ${TEACH_MAX_WORDS} words) — teach two things as two notes.`;

export const TEACH_HELP =
  "To teach me something, type `/teach` followed by the note — for example `/teach Spark's freeze is documented under the Spark artifact`. " +
  `${TEACH_LENGTH_RULE} ` +
  "I review it to make sure it is a real note, then remember it for your future chats. " +
  "Teachings stay private to your account.";
