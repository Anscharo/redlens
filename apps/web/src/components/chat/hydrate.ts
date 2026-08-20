import type { ChatMsg, TraceRow } from "./useChatStream";
import type { StoredMessage } from "../../lib/conversationsApi";

// Pure mapping from persisted DB rows (GET /api/chat/conversations/:id) to
// the in-memory ChatMsg shape useChatStream renders. Rehydration loses only
// `rounds` (cosmetic — a "· N rounds" suffix; 0 renders cleanly) and `verify`
// (the reliability-harness badge, not persisted). `trace` (tool calls)
// restores in FULL: ToolCallRecord's `ok`/`bytes` are non-nullable on write,
// unlike the live-stream TraceRow which starts them null until tool_result
// arrives.
export function toChatMsgs(rows: StoredMessage[]): ChatMsg[] {
  return rows.map((row) => {
    const toolCalls = row.toolCalls ?? [];
    const trace: TraceRow[] = toolCalls.map((t) => ({
      name: t.name,
      args: t.args,
      ok: t.ok,
      bytes: t.bytes,
    }));
    return {
      role: row.role,
      content: row.content,
      trace,
      rounds: 0,
      sources: toolCalls,
      done: true,
      verify: undefined,
    };
  });
}
