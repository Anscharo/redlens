// /teach command parser. The rest of the message is the teaching; an empty
// body is still a command (the handler replies with usage help).
//
// Must be at the start of the message (leading whitespace allowed) so a
// sentence that mentions "/teach" mid-thought is still a normal question.

export const TEACH_MAX_CHARS = 8_000;

const TEACH_RE = /^\s*\/teach(?:\s+|$)/i;

export interface TeachCommand {
  /** Trimmed teaching body. Empty means the user sent `/teach` alone. */
  text: string;
}

export function parseTeachCommand(message: string): TeachCommand | null {
  if (!TEACH_RE.test(message)) return null;
  const text = message.replace(TEACH_RE, "").trim();
  return { text: text.length > TEACH_MAX_CHARS ? text.slice(0, TEACH_MAX_CHARS) : text };
}

export const TEACH_HELP =
  "To teach me something, type `/teach` followed by the note — for example `/teach Spark's freeze is documented under the Spark artifact`. " +
  "I review it to make sure it is a real note, then remember it for your future chats. " +
  "Teachings stay private to your account.";
