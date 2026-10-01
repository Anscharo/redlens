// /api/chat/conversations — list/read/rename/delete a user's chat history.
// Auth-gated, ownership scoped via WHERE user_id (mirrors collections.ts).
// Conversations themselves are created only by POST /api/chat
// (resolveConversation in chat.ts) — there is no POST here.
import { sql, toUuidArrayLiteral } from "../db.ts";
import { getSessionUser } from "../session.ts";
import { json } from "../http.ts";
// The context figures here and the compaction trigger must be the SAME
// arithmetic, or the badge describes a different thread than the one we decide
// to compact. contextUsedTokens is that one function; CHARS_PER_TOKEN is only for
// the list, which estimates in SQL rather than loading every row.
import { CHARS_PER_TOKEN, CONTEXT_OVERHEAD_TOKENS, contextUsedTokens, rowsAfterCursor, type ReplayRow } from "./context-compact.ts";
import type { RecallToolCall } from "./tool-recall-card.ts";
import { aggregateMarks, shownMarks, type CitationMark } from "./verify/citation-marks.ts";
import { withoutDisputedMarks } from "./verify/disputes.ts";
import {
  judgedPairsFrom,
  restoreVerify,
  answerCoverageFromRow,
  type VerifyOut,
  type AnswerCoverageOut,
} from "./verify/persisted-verdict.ts";
import { reviewNoteFrom, type ReviewNote } from "./verify/review-note.ts";



interface ConversationListOut {
  id: string;
  title: string | null;
  updatedAt: string;
  messageCount: number;
  // How full this conversation's REPLAY is — the rows a turn would send plus
  // the standing prefix, estimated in SQL (see listConversations). Not the
  // measured prompt_tokens of a past round: that counts one turn's tool
  // results, which never come back, so it fell as often as it rose. The
  // measured value is still stored per message for cost and calibration.
  contextTokens: number;
  // Always true here: the list estimates rather than loading every row's
  // lookup cards. The UI renders it with a "~".
  contextEstimated: boolean;
}

interface MessageOut {
  role: string;
  content: string;
  createdAt: string;
  toolCalls: unknown;
  // Per-cited-doc Sources-chip marks, reconstructed from the persisted
  // citation_check row (see citationMarksFor below) — null when there is
  // nothing to show: no row was ever written for this message (feature off,
  // small-talk bypass, no citations in the answer), or the row's judged pairs
  // folded down to zero marks. Reconciled against `verify`'s agreed
  // contradictions (withoutDisputedMarks) before being returned, so a doc an
  // agreed contradiction is sourced to never shows a green ✓ alongside it —
  // same reconciliation the live wire path applies.
  citationMarks: Record<string, CitationMark> | null;
  // Reliability-harness badge, reconstructed from the persisted 'verify' +
  // 'round_checks' message_checks rows (see verifyFor below — the actual
  // reconstruction rule lives in verify/persisted-verdict.ts's restoreVerify)
  // — null when neither row restores anything: no 'verify' row AND no
  // 'round_checks' row whose deterministic checks failed, or nothing in
  // either survived parsing. restoreVerify's own comment covers the one case
  // that is NOT "harness was off": a 'round_checks' row alone still restores
  // a fail badge when the verifier model was off but the deterministic checks
  // failed, mirroring chat-orchestrator.ts's `emitVerify`.
  verify: VerifyOut | null;
  // "Did it answer the question?" line, reconstructed from the persisted
  // 'answer_coverage' message_checks row (see answerCoverageFor below) — null
  // when no row was ever written for this message (feature off, small-talk
  // bypass, judgeAnswerCoverage fail-opened to null) or the row didn't
  // survive parsing.
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
  // Previously the newest row's measured prompt_tokens, which described one
  // past round rather than this conversation.
  contextTokens: number;
  messages: MessageOut[];
}

// Server-side safety cap on a renamed title (the UI enforces a tighter
// 48-char maxLength; this guards a direct authenticated PATCH).
const MAX_TITLE_LEN = 120;

// One query, no N+1 (unlike listCollections' per-row itemsFor()) — a user's
// conversation count grows unbounded, a per-row follow-up query wouldn't.
// The EXISTS is NOT redundant with the JOIN: a plain JOIN only filters
// ZERO-message conversations, which barely occur. What actually accumulates
// is "user asked, stream died, no reply" — a rate-limited turn leaves no row
// at all (429 returns before resolveConversation), but an ABORTED turn
// leaves a row with exactly ONE message (the user insert; persistAssistant
// is skipped on abort) — messageCount=1, and a plain JOIN returns it happily.
// That junk would list under the raw slice(0,60) seed forever (titling only
// fires after persistAssistant). EXISTS(...role='assistant') is what hides
// it. The JOIN stays alongside it only because messageCount is displayed.
async function listConversations(userId: string): Promise<ConversationListOut[]> {
  // One aggregate per conversation. The cursor LATERAL resolves one row by
  // primary key per conversation, not per message, because it is correlated on
  // c.summary_upto_id rather than on m.
  const rows = (await sql`
    SELECT t.id, t.title, t.updated_at, t.message_count, t.replay_chars
    FROM (
      SELECT c.id, c.title, c.updated_at, count(m.id)::int AS message_count,
        -- Only the rows a turn would REPLAY: everything after the compaction
        -- cursor, plus the summary that stands in for what came before. Summing
        -- every row instead counted messages already compacted away, so a
        -- compacted conversation read as its pre-compaction size forever.
        COALESCE(sum(length(m.content)) FILTER (WHERE cut.at IS NULL OR m.created_at > cut.at), 0)::int
          + COALESCE(length(c.summary), 0)::int AS replay_chars
      FROM conversations c
      JOIN messages m ON m.conversation_id = c.id
      LEFT JOIN LATERAL (SELECT cm.created_at AS at FROM messages cm WHERE cm.id = c.summary_upto_id) cut ON true
      WHERE c.user_id = ${userId}
        AND EXISTS (SELECT 1 FROM messages a WHERE a.conversation_id = c.id AND a.role = 'assistant')
      GROUP BY c.id, c.title, c.updated_at, c.summary
      ORDER BY c.updated_at DESC
      LIMIT 100
    ) t
    ORDER BY t.updated_at DESC
  `) as { id: string; title: string | null; updated_at: string | Date; message_count: number; replay_chars: number }[];
  return rows.map((r) => ({
    id: r.id, title: r.title, updatedAt: new Date(r.updated_at).toISOString(), messageCount: r.message_count,
    // Replayed text / 4, plus the standing prefix — the same shape as
    // contextUsedTokens, which the detail route and the live meter compute
    // exactly. Approximated here because the exact figure needs every row's
    // lookup cards loaded, and this is a list of up to 100 conversations: it
    // omits those cards and the summary's replay wrapper, so it reads a little
    // low on a tool-heavy thread. Always an estimate, hence contextEstimated.
    contextTokens: Math.ceil(r.replay_chars / CHARS_PER_TOKEN) + CONTEXT_OVERHEAD_TOKENS,
    contextEstimated: true,
  }));
}

// Reconstructs each assistant message's Sources-chip marks from its persisted
// citation_check row. Recomputes with aggregateMarks — the same fold a live
// turn uses — then `shownMarks`, so a reload draws the same two glyphs the
// live event did and a later change to either rule applies to old rows
// without a backfill. The stored `judged` pairs are not trimmed. ONE query
// for the whole conversation. A message with no citation_check row, or one
// whose pairs produce nothing a chip may draw, is absent from the map.
async function citationMarksFor(messageIds: string[]): Promise<Map<string, Record<string, CitationMark>>> {
  const out = new Map<string, Record<string, CitationMark>>();
  if (messageIds.length === 0) return out;
  const rows = (await sql`
    SELECT message_id, verdict FROM message_checks
    WHERE kind = 'citation_check' AND message_id = ANY(${toUuidArrayLiteral(messageIds)}::uuid[])
  `) as { message_id: string; verdict: unknown }[];
  for (const row of rows) {
    const judged = judgedPairsFrom(row.verdict);
    if (!judged) continue;
    const marks = shownMarks(aggregateMarks(judged));
    if (Object.keys(marks).length > 0) out.set(row.message_id, marks);
  }
  return out;
}

// Raw message_checks rows behind BOTH the reliability-harness badge
// (verifyFor) and the answer-coverage line (answerCoverageFor) below — ONE
// query for the whole conversation, shared by both features rather than one
// query each (a THIRD round trip beside citationMarksFor's own), same
// discipline citationMarksFor's own query already follows for the whole
// conversation vs one-per-message.
async function checksRowsFor(
  messageIds: string[],
): Promise<{ message_id: string; kind: string; verdict: unknown; overall: string | null }[]> {
  if (messageIds.length === 0) return [];
  return (await sql`
    SELECT message_id, kind, verdict, overall FROM message_checks
    WHERE kind IN ('verify', 'round_checks', 'answer_coverage') AND message_id = ANY(${toUuidArrayLiteral(messageIds)}::uuid[])
  `) as { message_id: string; kind: string; verdict: unknown; overall: string | null }[];
}

// Reconstructs each assistant message's VerifyOut from its 'verify' and
// 'round_checks' rows (a slice of checksRowsFor's shared fetch above). Pure —
// no SQL here — because all the parsing/recompute logic lives in
// verify/persisted-verdict.ts's restoreVerify, which is unit-tested directly
// there; this is just the row-grouping wiring.
//
// Grouped over the UNION of both kinds' message ids, not just the ids that
// have a 'verify' row — restoreVerify(null, ...) can still produce a fail
// badge from a 'round_checks' row alone (see restoreVerify's comment for
// exactly when: the verifier model was off for that turn but the
// deterministic checks failed anyway). A message with neither kind of row, or
// whose rows restore to null, is simply absent from the returned map — see
// MessageOut.verify's comment.
function verifyFor(
  rows: { message_id: string; kind: string; verdict: unknown; overall: string | null }[],
): Map<string, VerifyOut> {
  const out = new Map<string, VerifyOut>();
  const verifyRows = new Map<string, { verdict: unknown; overall: string | null }>();
  const roundChecksRows = new Map<string, unknown>();
  for (const row of rows) {
    if (row.kind === "verify") {
      // A verify row whose verdict isn't even an object (a future format
      // change, or a corrupted row) has nothing usable in it at all — treated
      // the same as no verify row existing, per MessageOut.verify's contract.
      // A row that IS an object but has malformed/missing sub-fields still
      // gets an entry below; each field degrades independently instead.
      if (!row.verdict || typeof row.verdict !== "object") continue;
      verifyRows.set(row.message_id, { verdict: row.verdict, overall: row.overall });
    } else if (row.kind === "round_checks") {
      roundChecksRows.set(row.message_id, row.verdict);
    }
  }
  for (const messageId of new Set([...verifyRows.keys(), ...roundChecksRows.keys()])) {
    const restored = restoreVerify(verifyRows.get(messageId) ?? null, roundChecksRows.get(messageId));
    if (restored) out.set(messageId, restored);
  }
  return out;
}

// Reconstructs each assistant message's "did it answer the question?" line
// from its 'answer_coverage' row (chat-orchestrator.ts's
// resolveAnswerCoverage / verify/answer-coverage.ts's judgeAnswerCoverage) —
// a slice of checksRowsFor's shared fetch above, same discipline as verifyFor.
// The defensive parse and the stored-shape-to-wire-shape mapping both live in
// verify/persisted-verdict.ts's answerCoverageFromRow; this is just the row
// filter. A message with no 'answer_coverage' row, or one that didn't survive
// parsing, is simply absent from the returned map.
function answerCoverageFor(
  rows: { message_id: string; kind: string; verdict: unknown; overall: string | null }[],
): Map<string, AnswerCoverageOut> {
  const out = new Map<string, AnswerCoverageOut>();
  for (const row of rows) {
    if (row.kind !== "answer_coverage") continue;
    const restored = answerCoverageFromRow(row.verdict);
    if (restored) out.set(row.message_id, restored);
  }
  return out;
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
function toReplayRow(
  r: { id: string; role: string; content: string; tool_calls: unknown },
  review: ReviewNote | null = null,
): ReplayRow {
  return { id: r.id, role: r.role, content: r.content, toolCalls: (r.tool_calls ?? null) as RecallToolCall[] | null, review };
}

// DESC-then-resort keeps the NEWEST 200 messages (a plain LIMIT keeps the
// oldest) — display-only. The model replays every row until context-compact
// compacts a prefix into conversations.summary.
async function getConversation(userId: string, id: string): Promise<ConversationDetailOut | null> {
  const owned = (await sql`
    SELECT c.id, c.title, c.updated_at, c.summary, c.summary_upto_id
    FROM conversations c WHERE c.id = ${id} AND c.user_id = ${userId}
  `) as {
    id: string; title: string | null; updated_at: string | Date;
    summary: string | null; summary_upto_id: string | null;
  }[];
  if (!owned.length) return null;
  const conv = owned[0];
  const rows = (await sql`
    SELECT * FROM (
      SELECT id, role, content, created_at, tool_calls
      FROM messages WHERE conversation_id = ${id}
      ORDER BY created_at DESC LIMIT 200
    ) t ORDER BY created_at
  `) as { id: string; role: string; content: string; created_at: string | Date; tool_calls: unknown }[];
  // Assistant rows only: a citation_check/verify/round_checks/answer_coverage
  // row is always recorded against the answer it checked, so user ids would
  // just widen the uuid array literal and the index probe for guaranteed
  // misses.
  const assistantIds = rows.filter((r) => r.role === "assistant").map((r) => r.id);
  const [marksByMessage, checksRows] = await Promise.all([citationMarksFor(assistantIds), checksRowsFor(assistantIds)]);
  const verifyByMessage = verifyFor(checksRows);
  const coverageByMessage = answerCoverageFor(checksRows);
  // reviewNoteFrom is the formatter half of review-note.ts, taking the values
  // this function has already restored rather than re-reading the rows — so the
  // meter here and the round the next turn sends are built from one formatter.
  const noteFor = (id: string): ReviewNote | null =>
    reviewNoteFrom({
      verify: verifyByMessage.get(id) ?? null,
      coverage: coverageByMessage.get(id) ?? null,
      marks: marksByMessage.get(id) ?? {},
    });
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
    contextTokens: contextUsedTokens(conv.summary, rowsAfterCursor(rows.map((r) => toReplayRow(r, noteFor(r.id))), conv.summary_upto_id)),
    messages: rows.map((r) => {
      const marks = marksByMessage.get(r.id) ?? null;
      const verify = verifyByMessage.get(r.id) ?? null;
      return {
        role: r.role, content: r.content, createdAt: new Date(r.created_at).toISOString(), toolCalls: toolCallsForClient(r.tool_calls),
        // Reconciled against this message's own agreed contradictions before
        // returning — see MessageOut.citationMarks' comment and disputes.ts.
        citationMarks: marks ? withoutDisputedMarks(marks, verify?.contradictions ?? []) : null,
        verify,
        answerCoverage: coverageByMessage.get(r.id) ?? null,
      };
    }),
  };
}

async function renameConversation(
  userId: string, id: string, title: string,
): Promise<{ id: string; title: string; updatedAt: string } | null> {
  // Deliberately NO `updated_at = now()` here, unlike updateCollection's
  // unconditional bump — renaming must not reorder a list sorted by last-
  // message time (chat.ts bumps updated_at on every user message insert; see
  // that file). A future "consistency" pass that copies updateCollection's
  // pattern would silently break "rename doesn't jump to top" — don't.
  const rows = (await sql`
    UPDATE conversations SET title = ${title}, title_source = 'user'
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, title, updated_at
  `) as { id: string; title: string; updated_at: string | Date }[];
  if (!rows.length) return null;
  const r = rows[0];
  return { id: r.id, title: r.title, updatedAt: new Date(r.updated_at).toISOString() };
}

// DELETE cascades messages (and via messages, message_checks) with the
// conversation. That deliberately does NOT refund rate-limit quota: usage is
// accounted in the append-only `usage_events` ledger (017_usage_events.sql),
// whose conversation_id is ON DELETE SET NULL, so the row survives this
// delete and getWindowUsage still counts it. Do not add explicit
// usage_events cleanup here — that would hand a throttled user a way to
// reclaim quota by deleting conversations.
async function deleteConversation(userId: string, id: string): Promise<boolean> {
  const deleted = (await sql`
    DELETE FROM conversations WHERE id = ${id} AND user_id = ${userId} RETURNING id
  `) as { id: string }[];
  return deleted.length > 0;
}

export async function handleConversations(req: Request): Promise<Response> {
  const session = await getSessionUser(req);
  if (!session) return json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const { pathname } = new URL(req.url);
  const id = pathname.match(/^\/api\/chat\/conversations(?:\/([^/]+))?$/)?.[1];

  if (!id && req.method === "GET") {
    return json(await listConversations(userId), 200, session.refresh);
  }

  if (id && req.method === "GET") {
    const conv = await getConversation(userId, id);
    if (!conv) return json({ error: "not_found" }, 404);
    return json(conv, 200, session.refresh);
  }

  if (id && req.method === "PATCH") {
    let body: { title?: string };
    try {
      body = (await req.json()) as { title?: string };
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const title = body.title?.trim() ?? "";
    if (!title) return json({ error: "empty_title" }, 400);
    if (title.length > MAX_TITLE_LEN) return json({ error: "title_too_long" }, 400);
    const updated = await renameConversation(userId, id, title);
    if (!updated) return json({ error: "not_found" }, 404);
    return json(updated, 200, session.refresh);
  }

  if (id && req.method === "DELETE") {
    const ok = await deleteConversation(userId, id);
    if (!ok) return json({ error: "not_found" }, 404);
    return json({ ok: true }, 200, session.refresh);
  }

  return json({ error: "method_not_allowed" }, 405);
}
