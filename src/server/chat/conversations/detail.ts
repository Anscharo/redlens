// GET /api/chat/conversations/:id — one conversation's messages, each with the
// Sources marks, verify badge and answer-coverage line the live turn showed.
import { sql } from "../../db.ts";
// The context figure here and the compaction trigger must be the SAME
// arithmetic, or the badge describes a different thread than the one we decide
// to compact. contextUsedTokens is that one function.
import { contextUsedTokens, rowsAfterCursor, type ReplayRow } from "../context-compact.ts";
import type { RecallToolCall } from "../tool-recall-card.ts";
import type { CitationMark } from "../verify/citation-marks.ts";
import { withoutDisputedMarks } from "../verify/disputes.ts";
import type { VerifyOut, AnswerCoverageOut } from "../verify/persisted-verdict.ts";
import { reviewNoteFrom, type ReviewNote } from "../verify/review-note.ts";
import { checksByMessage, type MessageChecks } from "./checks.ts";

interface MessageOut {
  role: string;
  content: string;
  createdAt: string;
  toolCalls: unknown;
  // Per-cited-doc Sources-chip marks, reconstructed from the persisted
  // citation_check row (see checks.ts's citationMarksFor) — null when there is
  // nothing to show: no row was ever written for this message (feature off,
  // small-talk bypass, no citations in the answer), or the row's judged pairs
  // folded down to zero marks. Reconciled against `verify`'s agreed
  // contradictions (withoutDisputedMarks) before being returned, so a doc an
  // agreed contradiction is sourced to never shows a green ✓ alongside it —
  // same reconciliation the live wire path applies.
  citationMarks: Record<string, CitationMark> | null;
  // Reliability-harness badge, reconstructed from the persisted 'verify' +
  // 'round_checks' message_checks rows (see checks.ts's verifyFor — the actual
  // reconstruction rule lives in verify/persisted-verdict.ts's restoreVerify)
  // — null when neither row restores anything: no 'verify' row AND no
  // 'round_checks' row whose deterministic checks failed, or nothing in
  // either survived parsing. restoreVerify's own comment covers the one case
  // that is NOT "harness was off": a 'round_checks' row alone still restores
  // a fail badge when the verifier model was off but the deterministic checks
  // failed, mirroring the harness's `emitVerify`.
  verify: VerifyOut | null;
  // "Did it answer the question?" line, reconstructed from the persisted
  // 'answer_coverage' message_checks row (see checks.ts's answerCoverageFor) —
  // null when no row was ever written for this message (feature off,
  // small-talk bypass, judgeAnswerCoverage fail-opened to null) or the row
  // didn't survive parsing.
  answerCoverage: AnswerCoverageOut | null;
}

interface ConversationDetailOut {
  id: string;
  title: string | null;
  updatedAt: string;
  // The EXACT replay size (contextUsedTokens over this conversation's own rows
  // and cards), where the list settles for a SQL approximation. It seeds the
  // live panel's meter/edge line, so a reopened chat reads the same as the turn
  // that produced it, and both track the one quantity a compaction reacts to.
  contextTokens: number;
  messages: MessageOut[];
}

interface MessageRow {
  id: string;
  role: string;
  content: string;
  created_at: string | Date;
  tool_calls: unknown;
}

// Lookup cards (recall / recall_id) are model-replay fields. The client trace
// only reads name, args, ok, bytes — strip the rest so a reloaded chat does
// not ship the card text.
function toolCallsForClient(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((t) => {
    if (!t || typeof t !== "object") return t;
    const { recall: _recall, recall_id: _id, ...rest } = t as Record<string, unknown>;
    return rest;
  });
}

/**
 * A stored row as the replay estimator reads it (content + its lookup cards +
 * the review note the next turn will replay).
 *
 * The note HAS to be here, not just on the live path: contextUsedTokens counts
 * the review round, so a reopened conversation that omitted it would meter lower
 * than the turn it is about to send.
 */
function toReplayRow(r: MessageRow, review: ReviewNote | null = null): ReplayRow {
  return { id: r.id, role: r.role, content: r.content, toolCalls: (r.tool_calls ?? null) as RecallToolCall[] | null, review };
}

// reviewNoteFrom is the formatter half of review-note.ts, taking the values
// already restored rather than re-reading the rows — so the meter here and the
// round the next turn sends are built from one formatter.
function reviewNoteFor(checks: MessageChecks, id: string): ReviewNote | null {
  return reviewNoteFrom({
    verify: checks.verify.get(id) ?? null,
    coverage: checks.coverage.get(id) ?? null,
    marks: checks.marks.get(id) ?? {},
  });
}

function messageOut(r: MessageRow, checks: MessageChecks): MessageOut {
  const marks = checks.marks.get(r.id) ?? null;
  const verify = checks.verify.get(r.id) ?? null;
  return {
    role: r.role, content: r.content, createdAt: new Date(r.created_at).toISOString(), toolCalls: toolCallsForClient(r.tool_calls),
    // Reconciled against this message's own agreed contradictions before
    // returning — see MessageOut.citationMarks' comment and disputes.ts.
    citationMarks: marks ? withoutDisputedMarks(marks, verify?.contradictions ?? []) : null,
    verify,
    answerCoverage: checks.coverage.get(r.id) ?? null,
  };
}

async function ownedConversation(userId: string, id: string) {
  const owned = (await sql`
    SELECT c.id, c.title, c.updated_at, c.summary, c.summary_upto_id
    FROM conversations c WHERE c.id = ${id} AND c.user_id = ${userId}
  `) as {
    id: string; title: string | null; updated_at: string | Date;
    summary: string | null; summary_upto_id: string | null;
  }[];
  return owned[0] ?? null;
}

// DESC-then-resort keeps the NEWEST 200 messages (a plain LIMIT keeps the
// oldest) — display-only. The model replays every row until context-compact
// compacts a prefix into conversations.summary.
async function recentMessages(id: string): Promise<MessageRow[]> {
  return (await sql`
    SELECT * FROM (
      SELECT id, role, content, created_at, tool_calls
      FROM messages WHERE conversation_id = ${id}
      ORDER BY created_at DESC LIMIT 200
    ) t ORDER BY created_at
  `) as MessageRow[];
}

export async function getConversation(userId: string, id: string): Promise<ConversationDetailOut | null> {
  const conv = await ownedConversation(userId, id);
  if (!conv) return null;
  const rows = await recentMessages(id);
  // Assistant rows only: a citation_check/verify/round_checks/answer_coverage
  // row is always recorded against the answer it checked, so user ids would
  // just widen the uuid array literal and the index probe for guaranteed
  // misses.
  const checks = await checksByMessage(rows.filter((r) => r.role === "assistant").map((r) => r.id));
  const replay = rows.map((r) => toReplayRow(r, reviewNoteFor(checks, r.id)));
  return {
    id: conv.id,
    title: conv.title,
    updatedAt: new Date(conv.updated_at).toISOString(),
    // Exactly what the next turn will read — the same function the compaction
    // gate calls, over the same rows, including each row's lookup cards. So the
    // meter a reopened chat shows is the meter the live turn showed, and both
    // move only when the replay itself does. (Bounded by the 200-row fetch
    // above: a thread that has never compacted and still holds more than 200
    // messages would read low, which needs ~200 short messages — far below the
    // compaction line — to happen at all.)
    contextTokens: contextUsedTokens(conv.summary, rowsAfterCursor(replay, conv.summary_upto_id)),
    messages: rows.map((r) => messageOut(r, checks)),
  };
}
