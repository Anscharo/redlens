import type { ChatMsg, TraceRow } from "./useChatStream";
import type { StoredMessage } from "../../lib/conversationsApi";

// Pure mapping from persisted DB rows (GET /api/chat/conversations/:id) to
// the in-memory ChatMsg shape useChatStream renders. Rehydration loses only
// `rounds` (cosmetic — a "· N rounds" suffix; 0 renders cleanly) and the
// post-answer checks — `verify` (the reliability-harness badge), the Sources
// chip marks and the answer-coverage line — none persisted. `trace` (tool calls)
// restores in FULL: ToolCallRecord's `ok`/`bytes` are non-nullable on write,
// unlike the live-stream TraceRow which starts them null until tool_result
// arrives. A restored message is always the reveal state: `draft` empty,
// `generated: true` — there is no live stream to hydrate a draft from.
export function toChatMsgs(rows: StoredMessage[]): ChatMsg[] {
  return rows.map((row) => {
    const toolCalls = row.toolCalls ?? [];
    const trace: TraceRow[] = toolCalls.map((t) => ({
      name: t.name,
      args: t.args,
      ok: t.ok,
      bytes: t.bytes,
      round: 0,
    }));
    return {
      role: row.role,
      content: row.content,
      draft: "",
      generated: true,
      trace,
      rounds: 0,
      sources: toolCalls,
      done: true,
      verify: undefined,
      // citation_marks is a live-turn event like verify_result — not
      // persisted, so a reloaded message never carries stale marks.
      citationMarks: undefined,
      // Same for answer_coverage: the "didn't answer" / "didn't address" line
      // is live-only, like the verify badge it sits under.
      answerCoverage: undefined,
    };
  });
}
