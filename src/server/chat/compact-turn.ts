// The one place a chat turn compacts its own history: runs the summarization,
// records the outcome, and stores the summary with its cursor. chat.ts calls it
// from two places that differ only in WHEN they run.
//
//   - AFTER the answer, unawaited — the ordinary case. The summary it writes is
//     read by the NEXT turn and never by this one, so making the user wait for
//     it bought nothing and cost real dead air: nothing can reach the browser
//     until the route handler has returned its Response, so a summarization
//     before the first token showed a pending request with zero bytes for up to
//     chatSummaryTimeoutMs. A thread at the COMPACT_RATIO line still fits the
//     window by design, so the turn or two that replay it un-compacted while
//     this runs are under the model's limit — and if the estimate was wrong,
//     that is the rejection path below, not a new failure mode.
//   - BEFORE the turn, awaited — the recovery case only. The provider has
//     already rejected this thread for length (context-overflow.ts), so the
//     turn cannot proceed until the prefix is smaller. There the wait is the
//     price of answering at all.
import { sql } from "../db.ts";
import { config } from "../config.ts";
import type { JsonCall } from "./llm.ts";
import { captureError, type ErrorContext } from "../posthog-node.ts";
import { convFlags } from "./conv-flags.ts";
import {
  clearSummaryFailure,
  compactForReplay,
  noteSummaryFailure,
  summaryCoolingDown,
  type ReplayRow,
} from "./context-compact.ts";
import { clearContextOverflow } from "./context-overflow.ts";

/**
 * How long a conversation counts as already compacting. Only a backstop: the
 * flag is cleared in a finally, so this matters solely if that never runs. Twice
 * the call's own timeout, because the flag must outlive the longest call it is
 * guarding and nothing is lost by erring long — a stale flag skips one
 * compaction, which the next turn retries.
 */
export const COMPACTION_IN_FLIGHT_TTL_MS = config.chatSummaryTimeoutMs * 2;

const compacting = convFlags(COMPACTION_IN_FLIGHT_TTL_MS);

/** Exported for tests: is a summarization already running for this conversation? */
export function compactionInFlight(convId: string, now = Date.now()): boolean {
  return compacting.has(convId, now);
}

export interface CompactTurnInput {
  convId: string;
  /**
   * Everything since the last compaction — `rowsAfterCursor`'s output, plus
   * this turn's answer when called after it. An appended answer row carries no
   * id, which is safe: it is the LAST row, `planCompaction` always keeps the
   * last row in the verbatim tail, and `planWithinLine` never shrinks that tail
   * below 1 — so it can never be the row `summary_upto_id` points at.
   */
  rows: ReplayRow[];
  summary: string | null;
  /** Injected rather than built here, like titleConversation's — so the tests
   *  need no network or client mock, only the db one. */
  call: JsonCall;
  obs: ErrorContext;
  /** Recovery path: compact even though the estimate says the thread fits. */
  force?: boolean;
}

/** The replay after this call: unchanged unless a summary actually landed. */
export interface CompactTurnResult {
  summary: string | null;
  rows: ReplayRow[];
  /**
   * Whether a summary call was actually made — false when a guard stood this
   * one down (no model, cooling off, or one already in flight for this
   * conversation). The forced caller reports this, NOT its own intent, to
   * context-overflow.ts: a forced compaction that was skipped because another
   * was already running must not spend the one attempt per rejection, or the
   * user is told to start a new chat while the summary that would have fixed
   * the thread is landing.
   */
  attempted: boolean;
}

export async function compactTurn(input: CompactTurnInput): Promise<CompactTurnResult> {
  const { convId, rows, summary, call, obs, force = false } = input;
  const unchanged = { summary, rows, attempted: false };
  if (!config.chatSummaryModel) return unchanged;
  // A failed summary is not retried for SUMMARY_FAILURE_COOLDOWN_MS, so a hung
  // summary model cannot cost every later turn a timeout. `force` overrides it:
  // without a smaller prefix that turn is going to be rejected again anyway.
  if (!force && summaryCoolingDown(convId)) return unchanged;
  // One summarization per conversation at a time. Several turns sent while one
  // is running would otherwise each start their own. In-memory is enough
  // because the summary and its cursor are written in ONE statement: a missed
  // guard costs a duplicate call, never a mismatch, since whichever UPDATE
  // lands last leaves a summary covering exactly up to its own cursor.
  if (compacting.has(convId)) return unchanged;
  compacting.set(convId);
  try {
    const compacted = await compactForReplay({
      rows,
      summary,
      windowTokens: config.chatContextWindowTokens,
      call,
      model: config.chatSummaryModel,
      timeoutMs: config.chatSummaryTimeoutMs,
      force,
    });
    if (compacted.failed) noteSummaryFailure(convId);
    if (!compacted.compacted) return { ...unchanged, attempted: true };
    clearSummaryFailure(convId);
    clearContextOverflow(convId);
    // Summary and cursor in one statement, so no reader can ever see a summary
    // paired with another attempt's cursor. If the write fails the next turn
    // re-reads the old cursor and compacts again — a second, different summary
    // and a cache miss. Captured, never fatal: the answer already shipped.
    await sql`
      UPDATE conversations SET summary = ${compacted.summary}, summary_upto_id = ${compacted.uptoId} WHERE id = ${convId}
    `.catch((err) => {
      captureError(err, obs, { stage: "compact_summary" });
    });
    return { summary: compacted.summary, rows: compacted.rows, attempted: true };
  } finally {
    compacting.clear(convId);
  }
}
