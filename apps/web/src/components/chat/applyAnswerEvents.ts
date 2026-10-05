import type { MessageEventHandlers } from "./applyEvent";
import type { ChatMsg } from "./chatTypes";
import { clearInFlightModelMarks } from "./paragraphCheckList";
import { appendReasoning, splitToolRoundText } from "./splitToolRound";

// `clear` sets the live draft aside. `degenerate` is the ONE clear that really
// deletes — a repetition loop, machine noise no one wants back. Every other
// clear (`tool_round` / absent reason) keeps what streamed — restyled, pushed
// above the replacement, never deleted. Whitespace-only buffers are dropped:
// nothing to read. Mixed preamble + leaked tool-call markup: markup is
// thinking, not a draft; the rest stays a prechecked answer.
const clear: MessageEventHandlers["clear"] = (m, ev) => {
  const kept = m.superseded ?? [];
  if (ev.reason === "degenerate" || !m.draft.trim()) return { ...m, draft: "", paragraphChecks: [] };
  const { thinking, draft } = splitToolRoundText(m.draft);
  return {
    ...m,
    draft: "",
    paragraphChecks: [],
    reasoning: appendReasoning(m.reasoning, thinking),
    superseded: draft
      ? [...kept, { text: draft, reason: "tool_round" as const, round: m.rounds, checks: m.paragraphChecks }]
      : kept,
  };
};

// The turn is over. `content` is the authoritative final answer. Any mark
// still in flight is cleared (verify_result usually already did — see
// clearInFlightModelMarks); superseded drafts keep their own checks frozen
// from when they were set aside, so they need the same clear. A "checking"
// chip that never resolved (verifier off/failed silently) must not spin
// forever.
const done: MessageEventHandlers["done"] = (m, ev): ChatMsg => ({
  ...m,
  content: ev.content,
  generated: true,
  draft: "",
  sources: ev.toolCalls,
  done: true,
  statusLine: null,
  paragraphChecks: clearInFlightModelMarks(m.paragraphChecks),
  superseded: m.superseded?.map((d) => ({ ...d, checks: clearInFlightModelMarks(d.checks) })),
  ...(m.verify?.status === "checking" ? { verify: undefined } : {}),
});

// The answer's text: the live draft, its reveal, and the turn's end.
export const answerEventHandlers: MessageEventHandlers = {
  // Live buffer only — `content` stays empty until answer_final/done.
  token: (m, ev) => ({ ...m, draft: m.draft + ev.text, statusLine: null }),
  // Own field — never joins draft/content (answer prose, verified).
  reasoning: (m, ev) => ({ ...m, reasoning: (m.reasoning ?? "") + ev.text }),
  clear,
  answer_final: (m, ev) => ({ ...m, content: ev.content, generated: true, draft: "" }),
  done,
};
