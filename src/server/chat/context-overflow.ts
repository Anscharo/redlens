// What happens when the provider — not our estimate — says the request was
// too long.
//
// compactForReplay decides from an ESTIMATE (CHARS_PER_TOKEN, 4). The estimate
// can be wrong in the unsafe direction: a JSON-heavy or non-English thread
// tokenizes worse than the prose it was measured on. When it is wrong the
// provider rejects the request and, before this module existed, the turn died
// with a raw provider 400 in the user's face and every later turn of that
// conversation died the same way. Instead:
//   - the user gets a plain-language message saying what to do next;
//   - the conversation is flagged, and its next turn folds the prefix even
//     though the estimate says it fits (compactForReplay's `force`), keeping a
//     shorter verbatim tail — so the thread heals itself on the next message.
//
// Deliberately NOT a retry inside the same turn: everything before the first
// token (Jev judgement, facts round, /teach filtering) would have to run again,
// or prepareTurn's assembly would have to be duplicated to rebuild the messages
// without it — and the same message re-sent takes the healed path anyway.
import { convFlags } from "./conv-flags.ts";

// Provider wording varies and OpenRouter passes it through from whichever
// upstream served the request, so match on the phrases rather than a status
// code: OpenAI's "maximum context length … Please reduce the length of the
// messages", Anthropic's "prompt is too long: N tokens > M maximum", the
// `context_length_exceeded` code, and OpenRouter's own "This endpoint's
// maximum context length is N tokens".
// The phrases name what was too big (context, prompt, messages, input) rather
// than just "too long" or "reduce the length": an output-token complaint
// ("max_tokens is too large") must not read as a thread that needs folding.
const OVERFLOW_PATTERNS = [
  /context[ _-]?length/i,
  /context[ _-]?window/i,
  /maximum context/i,
  /prompt is too long/i,
  /too many input tokens/i,
  /reduce the (?:length|number) of (?:the )?(?:messages|prompt|input|conversation)/i,
  /request too large/i,
];

/** message + code, including one nesting level (the OpenAI SDK's `error` body). */
function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (!err || typeof err !== "object") return "";
  const e = err as { message?: unknown; code?: unknown; error?: unknown };
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v) parts.push(v);
  };
  push(e.message);
  push(e.code);
  if (typeof e.error === "string") push(e.error);
  else if (e.error && typeof e.error === "object") {
    const nested = e.error as { message?: unknown; code?: unknown };
    push(nested.message);
    push(nested.code);
  }
  return parts.join(" | ");
}

export function isContextOverflowError(err: unknown): boolean {
  const text = errorText(err);
  return text !== "" && OVERFLOW_PATTERNS.some((re) => re.test(text));
}

/**
 * A thread stays flagged for a day. The flag is read on that conversation's
 * NEXT turn, which may be minutes or hours later; expiring it sooner would
 * only mean the user hits the same wall once more before the fold happens.
 */
const OVERFLOW_TTL_MS = 24 * 60 * 60_000;

const overflowed = convFlags(OVERFLOW_TTL_MS);
// A forced fold ran and the request was rejected anyway: the verbatim tail
// itself is too large, so folding is spent on this conversation. Without this
// second verdict, every later message in a thread the user keeps using would
// buy one wasted summary call and the same rejection, for a day.
const foldSpent = convFlags(OVERFLOW_TTL_MS);

/**
 * Should this turn fold even though the estimate says the thread fits? True
 * once the provider has rejected the thread, until a fold has been tried.
 * The two flags are read nowhere else: the caller asks this question and
 * `noteContextOverflow` below, so the state machine cannot be re-derived
 * (differently) at a call site.
 */
export function shouldForceFold(convId: string, now = Date.now()): boolean {
  return overflowed.has(convId, now) && !foldSpent.has(convId, now);
}

/**
 * Record a length rejection and return what to tell the user. One function
 * because the flag and the copy are the same decision: promising "the earlier
 * turns will be condensed" is only honest while a fold is still available.
 *
 * `forcedThisTurn` is whether this turn already folded under `shouldForceFold`
 * — asked for, not necessarily landed: compactForReplay also returns unchanged
 * when the summary call fails. Spent is still the right verdict there, since a
 * summary model that just failed cannot rescue the next turn either, and a fold
 * that does land later clears both flags.
 *
 * The message carries no trailing period and no "try again" of its own:
 * ErrorNote appends "— send another message to try again." to every error event.
 */
export function noteContextOverflow(
  convId: string,
  opts: { forcedThisTurn: boolean; compactionEnabled: boolean },
  now = Date.now(),
): string {
  const foldTried = opts.forcedThisTurn || foldSpent.has(convId, now);
  if (foldTried) foldSpent.set(convId, now);
  else overflowed.set(convId, now);
  return opts.compactionEnabled && !foldTried
    ? "This conversation has outgrown what the model can read in one request, so the earlier turns will be condensed first"
    : "This conversation has outgrown what the model can read in one request, and condensing it further will not help, so a new chat is the way on";
}

/** Called when a fold DOES land: the thread shrank, so both verdicts are stale. */
export function clearContextOverflow(convId: string): void {
  overflowed.clear(convId);
  foldSpent.clear(convId);
}
