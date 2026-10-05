// The persisted message_checks rows behind a reloaded conversation's Sources
// chips, verify badge and answer-coverage line. Two queries for the whole
// conversation, never one per message.
import { sql, toUuidArrayLiteral } from "../../db.ts";
import { aggregateMarks, shownMarks, type CitationMark } from "../verify/citation-marks.ts";
import {
  judgedPairsFrom,
  restoreVerify,
  answerCoverageFromRow,
  type VerifyOut,
  type AnswerCoverageOut,
} from "../verify/persisted-verdict.ts";

/** One message_checks row as the reload path reads it. */
export interface CheckRow {
  message_id: string;
  kind: string;
  verdict: unknown;
  overall: string | null;
}

/** Everything a reload restores per assistant message, keyed by message id. */
export interface MessageChecks {
  marks: Map<string, Record<string, CitationMark>>;
  verify: Map<string, VerifyOut>;
  coverage: Map<string, AnswerCoverageOut>;
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
// query each (a THIRD round trip beside citationMarksFor's own).
async function checksRowsFor(messageIds: string[]): Promise<CheckRow[]> {
  if (messageIds.length === 0) return [];
  return (await sql`
    SELECT message_id, kind, verdict, overall FROM message_checks
    WHERE kind IN ('verify', 'round_checks', 'answer_coverage') AND message_id = ANY(${toUuidArrayLiteral(messageIds)}::uuid[])
  `) as CheckRow[];
}

function groupVerifyRows(rows: CheckRow[]) {
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
  return { verifyRows, roundChecksRows };
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
function verifyFor(rows: CheckRow[]): Map<string, VerifyOut> {
  const out = new Map<string, VerifyOut>();
  const { verifyRows, roundChecksRows } = groupVerifyRows(rows);
  for (const messageId of new Set([...verifyRows.keys(), ...roundChecksRows.keys()])) {
    const restored = restoreVerify(verifyRows.get(messageId) ?? null, roundChecksRows.get(messageId));
    if (restored) out.set(messageId, restored);
  }
  return out;
}

// Reconstructs each assistant message's "did it answer the question?" line
// from its 'answer_coverage' row (written by the harness's
// resolveAnswerCoverage / verify/answer-coverage.ts's judgeAnswerCoverage) —
// a slice of checksRowsFor's shared fetch above, same discipline as verifyFor.
// The defensive parse and the stored-shape-to-wire-shape mapping both live in
// verify/persisted-verdict.ts's answerCoverageFromRow; this is just the row
// filter. A message with no 'answer_coverage' row, or one that didn't survive
// parsing, is simply absent from the returned map.
function answerCoverageFor(rows: CheckRow[]): Map<string, AnswerCoverageOut> {
  const out = new Map<string, AnswerCoverageOut>();
  for (const row of rows) {
    if (row.kind !== "answer_coverage") continue;
    const restored = answerCoverageFromRow(row.verdict);
    if (restored) out.set(row.message_id, restored);
  }
  return out;
}

/** The marks query and the shared checks query run concurrently. */
export async function checksByMessage(assistantIds: string[]): Promise<MessageChecks> {
  const [marks, rows] = await Promise.all([citationMarksFor(assistantIds), checksRowsFor(assistantIds)]);
  return { marks, verify: verifyFor(rows), coverage: answerCoverageFor(rows) };
}
