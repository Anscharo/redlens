// A synthetic tool round that hands the model the AGREED verifier
// contradictions raised against its OWN previous answer — the same list the
// user already saw rendered directly beneath that answer (message_checks
// kind='verify', filtered by verify/disputes.ts's agreedContradictionsFrom).
// Without this, a follow-up question like "are you sure about that dispute?"
// has nothing to reason from: the model's history is built from plain
// {role, content} rows (turn-setup.ts / chat.ts), so a dispute the UI showed
// is otherwise invisible to it.
//
// This rides its OWN tool round (mirrors facts/registry.ts's factRound and
// teach/inject.ts's teachingRound) rather than being appended onto the prior
// assistant message's `content`, for three reasons:
//   - the model reads its own `content` as its own prior prose — an appended
//     verifier note would look like something it said, not context handed to
//     it from outside;
//   - chat-history.ts's `truncateOld` slices anything past the lead paragraph
//     off turns older than `keepRecent` — a note appended past the lead
//     paragraph would silently disappear a couple of turns later, right when
//     a user is most likely to circle back and ask about it;
//   - title.ts's transcript builder reads assistant `content` verbatim to
//     title the conversation — a dispute note baked into content would leak
//     into a conversation title.
import type OpenAI from "openai";
import type { AgreedContradiction } from "./verify/disputes.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export const DISPUTE_TOOL_NAME = "atlas_dispute_flags";

// Long spans (a whole paragraph quoted as `answer`/`evidence`, or a verbose
// `why`) are capped so one long-winded flag cannot blow up the round's token
// cost. 300 chars comfortably holds a sentence or two — the unit these spans
// are always drawn at (refute.ts operates per-sentence/paragraph).
const MAX_SPAN_CHARS = 300;

function truncate(s: string): string {
  return s.length > MAX_SPAN_CHARS ? `${s.slice(0, MAX_SPAN_CHARS)}…` : s;
}

function entry(c: AgreedContradiction, i: number): string {
  const lines = [
    `${i + 1}. Your sentence: "${truncate(c.answer)}"`,
    `   Atlas text it was flagged against: "${truncate(c.evidence)}"`,
    `   The check's reason: "${truncate(c.why)}"`,
  ];
  if (c.uuid) lines.push(`   Source document: ${c.uuid}`);
  return lines.join("\n");
}

// "1 statement was flagged" vs "3 statements were flagged" — the singular
// count is common (most turns with a dispute have exactly one).
function lead(n: number): string {
  const noun = n === 1 ? "statement was" : "statements were";
  return (
    "A verification check ran on your previous answer, and its result was shown to the user directly beneath that answer. " +
    `${n} ${noun} flagged as disputed by the atlas:`
  );
}

const FOOTER =
  "This is a check result, not a ruling, and not retrieved evidence. The check compares sentences in isolation and can " +
  'misread scope, pronoun antecedents ("they", "these"), or which subject a rule applies to. If the user asks about a ' +
  "flag, look the source document up with atlas_get and reason about it before agreeing or disagreeing — do not assume " +
  "the flag is correct just because it was shown. Do not restate a flagged sentence unchanged.";

/**
 * Builds the dispute round, or `[]` when there is nothing to inject — the
 * common case (most answers carry no agreed contradiction). Pure and
 * deterministic: same input, same output, no I/O.
 *
 * Framing is deliberately NOT a verdict the model should capitulate to, and
 * NOT presented as retrieved atlas evidence either (see FOOTER) — the
 * originating bug report showed a case where the flag itself was likely
 * wrong (a pronoun-antecedent misread), so the model must be free to push
 * back on it, not parrot it.
 */
export function disputeRound(contradictions: AgreedContradiction[]): Msg[] {
  if (contradictions.length === 0) return [];
  const id = "call_dispute_flags";
  const body = contradictions.map(entry).join("\n\n");
  const content = `${lead(contradictions.length)}\n\n${body}\n\n${FOOTER}`;
  return [
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id, type: "function", function: { name: DISPUTE_TOOL_NAME, arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: id, content },
  ];
}
