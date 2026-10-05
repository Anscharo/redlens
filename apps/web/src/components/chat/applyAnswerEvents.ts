import type { MessageEventHandlers } from "./applyEvent";
import type { ChatMsg } from "./chatTypes";
import { clearInFlightModelMarks } from "./paragraphCheckList";
import { appendReasoning, splitToolRoundText } from "./splitToolRound";

// `clear` sets the live draft aside; only `degenerate` (a repetition loop) or a
// blank buffer deletes it. Leaked tool-call markup becomes thinking.
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

// In-flight marks clear here too (superseded drafts included) in case
// verify_result never came; an unresolved "checking" chip must not spin forever.
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

export const answerEventHandlers: MessageEventHandlers = {
  // Live buffer only — `content` stays empty until answer_final/done.
  token: (m, ev) => ({ ...m, draft: m.draft + ev.text, statusLine: null }),
  // Never joins draft/content, which is verified answer prose.
  reasoning: (m, ev) => ({ ...m, reasoning: (m.reasoning ?? "") + ev.text }),
  clear,
  answer_final: (m, ev) => ({ ...m, content: ev.content, generated: true, draft: "" }),
  done,
};
