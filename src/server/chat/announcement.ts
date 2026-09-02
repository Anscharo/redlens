// Did this round ANNOUNCE a lookup instead of performing one?
//
// chat-loop.ts's exit contract is "text + no usable tool calls = the final
// answer". Two neighbouring failures already have one-shot guards — content
// that comes back empty (COMPOSE_STEER) and content that degenerates into
// repetition (REPETITION_STEER) — but a round that writes "One moment while I
// search the atlas." and never emits a tool_call is non-empty and
// non-repetitive, so it shipped as the answer and the turn ended. Nothing
// downstream could catch it either: no citation, figure or quote means the
// deterministic checks have nothing to fail, and no factual claim means the
// verifier returns `claims: []`, which computeOverall degrades to `unverified`
// — the badge hides. In staged delivery the user waits through the whole turn
// and is then shown a promise. Observed live 2026-08-20; the user re-prompted
// ("Still going?") and the identical question then retrieved and answered
// normally, so the trigger is transient model behaviour, not a broken tool.
// It is NOT the malformed-delta path chat-loop.ts also documents:
// `chat_loop_malformed_tool_call` has never fired (0 events in 90 days).
//
// FIRST CONSUMER OF THE SIMILARITY MECHANISM THAT SCORES AN ANSWER, not a
// question. That is why the negative set below looks nothing like its siblings'
// (facts/similarity.ts's ATLAS_PROTOTYPES, concepts-prefetch.ts's
// CENSUS_NEGATIVE_PROTOTYPES, complexity.ts's COMPLEXITY_NEGATIVE_PROTOTYPES):
// the competing class here is not another kind of question, it is *an actual
// answer* — including the ones that legitimately need no tool call at all.
//
// The load-bearing suppressor is deterministic and runs first. An answer built
// from prefetch material (the features guide, glossary rows, entity rows,
// censuses) is required by the system prompt to link what it names —
// `[Radar](/radar)` — and a glossary answer states values; either way
// `isUncheckableAnswer` sees a markdown link or a digit and returns false, so
// the lane is never consulted. Only text with nothing checkable in it at all
// can reach the embedding. That is a structural answer to "don't fire on
// answers that needed no tool", not a statistical one.
import { isUncheckableAnswer } from "./verify/smalltalk.ts";
import { rankPrototypeSets } from "../facts/similarity.ts";
import { config } from "../config.ts";

// First-person promises to go and retrieve. Anchored on the SUBJECT ("let me",
// "I'll", "I'm going to") on purpose: an unanchored /searching the atlas/ also
// matches a perfectly good how-to answer ("Searching the atlas is done from the
// search bar"), which is the exact class this must never touch. Three idioms
// are further anchored on the RETRIEVAL half, because the population this gate
// sees is marker-free answers and the bare forms are ordinary prose (caught in
// the 2026-09-02 review; all five sentences are pinned as eval negatives):
//   - `see` needs a complement ("let me see WHAT the atlas…") — "Let me see.
//     The Facilitator reviews…" is an answer lead-in, not a promise;
//   - `looking` needs up/through/for/into — "I am looking AT two readings" is
//     the answer itself;
//   - the wait idiom lost bare `a` — "A second signer must approve" and "A
//     minute of the meeting" are subjects, not waits. `one`/`just a`/`give me
//     a` keep "One moment." and "Give me a second" matching.
export const ANNOUNCEMENT_RE: RegExp[] = [
  /\b(?:let me|i'?ll|i will|i'?m going to|i am going to|i'?m about to|allow me to)\s+(?:just\s+|quickly\s+|first\s+|now\s+)?(?:go\s+(?:and\s+)?)?(?:look|search|check|find|pull|fetch|retrieve|dig|consult|review|query|scan|see\s+(?:what|which|where|whether)\b)\b/i,
  /\b(?:i'?m|i am)\s+(?:now\s+)?(?:searching|checking|retrieving|fetching|querying|pulling|looking\s+(?:up|through|for|into)\b)\b/i,
  /\b(?:one|just a|give me a)\s+(?:moment|second|sec|minute)\b/i,
  /\b(?:hold on|hang on|bear with me|stand by)\b/i,
  /\bwhile i\s+(?:search|look|check|retrieve|find|pull|query)\b/i,
];

// Paraphrases of the INTENT, deliberately NOT the sentences in the eval corpus
// (scripts/eval/eval-announce-queries.ts) — including not the observed incident
// wording, which lives there as a labeled positive. Same convention as
// complexity.ts's COMPLEXITY_PROTOTYPES: the bakeoff measures generalization,
// not string recall.
export const ANNOUNCEMENT_PROTOTYPES: Record<string, string[]> = {
  announcement: [
    "I will look that up for you now",
    "give me a moment to check the documents",
    "let me find that information first",
    "I am going to search for the answer",
    "hold on while I gather the details",
    "I need to pull up the relevant records before I can say",
    "starting a lookup on that topic now",
    "I will report back once I have found it",
    // Subjectless / gerund promises. Measured: without these, "Fetching what
    // the atlas has on that, back shortly" scored -0.30 — below most real
    // answers — because every prototype was an "I will…" construction and the
    // embedding scores form as much as intent.
    "pulling the relevant documents together now",
    "gathering the details before answering",
    "checking the records for you, back shortly",
    "searching for that right now",
  ],
};

// The competing class: text that IS an answer, or is a legitimate reply that
// needs no lookup. Every group here was chosen because it shares the shape the
// positives have — short, first-person, no figures, no links — and must not be
// retried. In order: a plain factual answer, a product/how-to answer built from
// the injected features guide, a clarifying question, an honest gap admission,
// a scope refusal, and a greeting.
export const ANSWER_PROTOTYPES = [
  "that role is responsible for approving new instances",
  "the parameter is set by governance and applies to every instance",
  "you can open the reports page and export the table as a file",
  "browse entities on the radar page, or read documents in the reader",
  "which of the two primitives did you mean?",
  "could you say which scope you are asking about?",
  "the atlas does not appear to cover that topic",
  "I searched for that term and found no matching documents",
  "I only answer from the atlas, so that falls outside what I can cover",
  "hello, how can I help you with the atlas today?",
  "thanks — glad that was useful",
  "yes, that is correct, and it applies to every instance of the primitive",
];

// Scored PER SENTENCE, best sentence wins — the one structural difference from
// the three sibling lanes, and it is forced by scoring answers instead of
// questions. A question is one clause; an announcement is a clause buried in
// pleasantries, and averaging the whole blob drowns it. Measured on the corpus:
// the observed incident scores -0.41 whole-text (worse than most real answers,
// because "Hello! I'd be happy to help you with that" dominates) and -0.03 on
// its strongest sentence; "Happy to help with that. Gathering the details
// before I answer." goes 0.12 -> 0.65.
//
// The length floor is what keeps that from becoming noise: below it, fragments
// like "Good morning!" get scored alone and drift upward (measured: -0.59
// whole-text, +0.10 as a fragment). Sentences shorter than this are skipped,
// and a text with no qualifying sentence is scored whole.
const MIN_SCORED_SENTENCE = 20;

export function scorableSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= MIN_SCORED_SENTENCE);
  return parts.length ? parts : [text.trim()];
}

/**
 * Shape-only lane: does this text read as an announcement of pending work?
 *
 * Production reaches this through `announcesUnmadeToolCall`; `pnpm
 * eval:announce` sweeps thresholds through that same entry point, so eval and
 * server can never diverge on the rule (complexity.ts's `looksComplex` and
 * concepts-prefetch.ts's `routeCensuses` carry the identical note).
 *
 * Small talk is NOT gated here the way the sibling lanes gate it. `isSmallTalk`
 * classifies a user's greeting by word set; an assistant's greeting ("Hello!
 * I'm the Sky Atlas assistant — how can I help?") is a full sentence that no
 * word-set test recognises, so greetings are handled as a negative PROTOTYPE
 * class instead. Keep them there.
 */
export function looksLikeAnnouncement(text: string, margin = config.chatAnnouncementSimilarityMargin): boolean {
  if (!config.chatFactSimilarity) return false;
  return announcementMargin(text) >= margin;
}

/** Best per-sentence margin. Exported so the bakeoff can sweep it directly. */
export function announcementMargin(text: string): number {
  let best = -Infinity;
  for (const sentence of scorableSentences(text)) {
    const ranked = rankPrototypeSets(sentence, ANNOUNCEMENT_PROTOTYPES, ANSWER_PROTOTYPES);
    if (ranked.length) best = Math.max(best, ranked[0]!.margin);
  }
  return best === -Infinity ? -Infinity : best;
}

/**
 * THE GATE. Two lanes behind one deterministic envelope, cheapest first:
 *
 *   1. nothing at all      → the compose guard's case, not this one
 *   2. anything CHECKABLE  → it is an answer; never retried, never embedded
 *   3. regex               → a first-person promise to go and look
 *   4. similarity          → the phrasings no regex anticipates
 *
 * Step 2 is why an answer that legitimately made no tool call is safe: a
 * features answer carries `[Radar](/radar)`, a glossary answer carries a value,
 * a follow-up answered from earlier evidence carries its citation — all of them
 * fail `isUncheckableAnswer` and stop here, before the embedding runs.
 *
 * The caller owns the rest of the envelope (zero tool calls this turn, rounds
 * still available, not aborted, one shot only) — see chat-loop.ts.
 */
/**
 * The deterministic envelope, shared by both lanes AND by the bakeoff's regex
 * arm — an eval that rebuilt this by hand would be scoring a different rule
 * (facts/similarity.ts carries the same warning). Everything it rejects is an
 * answer, or is waiting on the user, and is never retried.
 */
export function couldAnnounce(content: string): boolean {
  const text = content.trim();
  if (!text) return false; // the compose guard's case
  // A link, figure or doc number ⇒ an answer. This also imports smalltalk.ts's
  // SMALLTALK_MAX_CHARS (600) cap: anything longer is treated as an answer and
  // never retried, even a rambling announcement. Accepted as a conservative
  // bias — every observed announcement is short, and the cost of being wrong
  // here is one un-retried promise, not a clobbered answer.
  if (!isUncheckableAnswer(text)) return false;
  // A turn that ends by asking the user something is waiting on them, and
  // waiting is a correct way to end a turn — retrying would talk over them.
  // This also closes the one edge the regex idioms leave open: "Hold on — did
  // you mean the Stability Scope?" matches /hold on/ but is a clarification.
  return !text.endsWith("?");
}

/** The regex lane alone, envelope included. Exported for the bakeoff's baseline arm. */
export function matchesAnnouncementRegex(content: string): boolean {
  const text = content.trim();
  return couldAnnounce(text) && ANNOUNCEMENT_RE.some((re) => re.test(text));
}

export function announcesUnmadeToolCall(content: string, margin?: number): boolean {
  const text = content.trim();
  if (!couldAnnounce(text)) return false;
  if (ANNOUNCEMENT_RE.some((re) => re.test(text))) return true;
  // Below one clause there is nothing for an embedding to read, and it does not
  // fail quietly: a bare "Answer." out-scored the shipped margin on noise alone
  // (caught by two orchestrator tests that stream exactly that). The regexes
  // above still cover the genuinely short cases — "One moment.", "Hold on." —
  // where the words themselves ARE the signal.
  if (text.length < MIN_SCORED_SENTENCE) return false;
  return looksLikeAnnouncement(text, margin);
}
