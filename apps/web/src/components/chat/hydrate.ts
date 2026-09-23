import type { ChatMsg, TraceRow } from "./useChatStream";
import type { StoredMessage } from "../../lib/conversationsApi";

// Pure mapping from persisted DB rows (GET /api/chat/conversations/:id) to
// the in-memory ChatMsg shape useChatStream renders. Rehydration loses only
// `rounds` (cosmetic — a "· N rounds" suffix; 0 renders cleanly) and two of
// the post-answer checks — `verify` (the reliability-harness badge) and the
// answer-coverage line — neither persisted. The Sources chip marks
// (`citationMarks`) DO survive a reload: the server reconstructs them from
// the persisted citation_check row with the same `aggregateMarks` fold a live
// turn uses (src/server/chat/conversations.ts's citationMarksFor), so this
// mapping just carries the field through. `trace` (tool calls) restores in
// FULL: ToolCallRecord's `ok`/`bytes` are non-nullable on write, unlike the
// live-stream TraceRow which starts them null until tool_result arrives. A
// restored message is always the reveal state: `draft` empty, `generated:
// true` — there is no live stream to hydrate a draft from.
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
      // Reconstructed server-side from the persisted citation_check row (see
      // this file's top comment); null (no row, or nothing survived
      // aggregation) becomes undefined, same as a message the live registry
      // never judged.
      citationMarks: row.citationMarks ?? undefined,
      // answer_coverage is a live-turn event like verify_result — not
      // persisted, so a reloaded message never carries a coverage line, like
      // the verify badge it sits under.
      answerCoverage: undefined,
    };
  });
}
