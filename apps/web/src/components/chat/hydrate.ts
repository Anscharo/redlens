import type { ChatMsg, TraceRow } from "./useChatStream";
import type { StoredMessage } from "../../lib/conversationsApi";

// Pure mapping from persisted DB rows (GET /api/chat/conversations/:id) to
// the in-memory ChatMsg shape useChatStream renders. Rehydration now loses
// only `rounds` (cosmetic — a "· N rounds" suffix; 0 renders cleanly): every
// post-answer check survives a reload. The server reconstructs each one from
// its persisted message_checks row rather than trusting a stored summary, so
// a future change to a fold applies to old rows without a backfill — Sources
// chip marks (`citationMarks`) through the same `aggregateMarks` a live turn
// uses, then reconciled against the verify row's agreed contradictions; the
// verify badge (`verify`) with the same `computeOverall`; and the
// answer-coverage line (`answerCoverage`) mapped down to the same shape the
// live `answer_coverage` event sends (the stored payload keeps richer
// per-part calibration data that the wire has never carried). All three live
// in src/server/chat/conversations.ts — citationMarksFor / verifyFor /
// answerCoverageFor — and this mapping just carries the fields through. `trace` (tool calls) restores
// in FULL: ToolCallRecord's `ok`/`bytes` are non-nullable on write, unlike the
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
      // Reconstructed server-side from the persisted 'verify'/'round_checks'
      // rows (see this file's top comment); null (no 'verify' row, or the
      // row didn't parse) becomes undefined, same as a live message the
      // harness never audited.
      verify: row.verify ?? undefined,
      // Reconstructed server-side from the persisted citation_check row (see
      // this file's top comment); null (no row, or nothing survived
      // aggregation) becomes undefined, same as a message the live registry
      // never judged.
      citationMarks: row.citationMarks ?? undefined,
      // Reconstructed server-side from the persisted answer_coverage row
      // (see this file's top comment); null (no row, or it didn't parse)
      // becomes undefined, same as a live turn that was never ruled.
      answerCoverage: row.answerCoverage ?? undefined,
    };
  });
}
