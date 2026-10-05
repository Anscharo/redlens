// Transient system steers the loop appends to one request. None of them is
// ever pushed onto the transcript: not persisted, not resent.

// Injected only on the final iteration, where tool_choice flips to "none" and the
// model MUST return text. Without it, a model that hasn't found what it wanted
// tends to narrate one more search ("Let me look up X…") as its answer — which,
// since it can't call tools, becomes a dangling non-answer the user sees verbatim.
// This forces a real answer or an honest "not found" instead.
export const FINAL_TURN_INSTRUCTION =
  "This is your final turn — no more tools are available. Write the complete answer now, using only the evidence already gathered above. Cite sources as instructed. If the gathered evidence does not answer the question, say plainly that the atlas does not appear to cover it and summarize what you did find. Do NOT describe further searches or say you will look something up — just answer.";

// Compose guard steer (one-shot, docs/chat-system.md §4).
// Even the forced-text final round can come back EMPTY — e.g. a model emitting
// tool-call deltas despite tool_choice:"none" leaves content blank after it
// burned every round on retrieval. A turn must never end with nothing: this
// steers one extra no-tools request toward an answer-or-honest-abstention.
export const COMPOSE_STEER =
  "Your research budget is exhausted — no tools are available. Using ONLY the evidence in the conversation above, write your final answer now. If the evidence does not answer the question, state plainly what you searched for and what was not found; a precise, honest summary of the gap IS the correct answer. Do not mention tools or further searches.";

// One-shot rewrite after the deterministic repetition handbrake trips (see
// repetition-guard.ts). The degenerate draft is cleared from the client and
// never pushed onto msgs — this steer alone asks for a clean rewrite.
export const REPETITION_STEER =
  "Your previous draft collapsed into repetitive nonsense (the same phrase or character looping). Discard it entirely. Write the complete answer once, cleanly, with no repeated filler. If the evidence does not answer the question, say so briefly — do not pad.";

// One-shot steer for the promised-tool guard (chat/announcement.ts). The round
// wrote "let me look that up" and emitted no tool_call, so the loop was about
// to ship the promise as the answer. The announcement itself is never pushed
// onto msgs — the plain-answer path doesn't push, and this guard `continue`s
// before it — so the replay sees the conversation exactly as the failed round
// saw it and cannot mistake its own promise for a kept one.
export const PROMISED_TOOL_STEER =
  "Your previous attempt announced a lookup ('let me check', 'one moment') but called no tool, so nothing was retrieved and the user received only that promise. Do not narrate what you are about to do. Call the tool you need NOW, in this turn, and then answer from its results. If the question genuinely needs no lookup, answer it directly and completely instead — but never reply with an intention to search.";

// Injected transiently on every mid-loop turn after the first tool round. The
// chat model tends to over-search — simple single-document questions burn
// 4–6 rounds before answering without it. This nudges "answer as soon as the
// evidence suffices" without capping rounds for genuinely complex questions.
// Like FINAL_TURN_INSTRUCTION it rides only the request, never lands in msgs.
export const EARLY_ANSWER_NUDGE =
  "Check the tool results above before searching again: if they already contain what the question needs, write the final answer now instead of calling more tools. Simple questions about a single document rarely need more than one or two lookups. Only continue if a specific fact you need is still missing — and never re-run a near-identical query.";
