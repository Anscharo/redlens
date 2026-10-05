// Everything POST /api/chat decides before the stream opens: the /teach
// branch, the history it replays (compacted first only when the provider
// rejected this conversation for length), the turn prepareTurn assembles,
// and the trace every generation and error of the turn lands in.
import { getIndexes } from "../../retrieval/indexes.ts";
import { makeOpenrouterJson } from "../llm.ts";
import type { Route } from "../model-router.ts";
import { prepareTurn } from "../turn-setup.ts";
import { contextUsedTokens, type ReplayRow } from "../context-compact.ts";
import { compactTurn } from "../compact-turn.ts";
import { shouldForceCompaction } from "../context-overflow.ts";
import type { RecallToolCall } from "../tool-recall-card.ts";
import { reviewNoteFromChecks } from "../verify/review-note.ts";
import type { CheckRowMeta } from "../chat-orchestrator.ts";
import { config } from "../../config.ts";
import { captureError, captureEvent } from "../../posthog-node.ts";
import { parseTeachCommand } from "../teach/parse.ts";
import { matchTeachings, type RankedTeaching } from "../teach/match.ts";
import { routeCensuses } from "../../concepts-prefetch.ts";
import { loadHistory } from "./history.ts";
import type { ChatBody } from "./gates.ts";

// /teach is its own path (review + persist, no atlas harness), so it never
// runs prepareTurn and records reason "teach".
const TEACH_ROUTE: Route = { tier: "default", reason: "teach" };

type TeachCmd = NonNullable<ReturnType<typeof parseTeachCommand>>;
type PreparedTurn = Awaited<ReturnType<typeof prepareTurn>>;
type TurnObs = { distinctId: string; traceId: string; properties: Record<string, unknown> };

export interface ChatTurn {
  req: Request;
  userId: string;
  convId: string;
  body: ChatBody;
  obs: TurnObs;
  teachCmd: TeachCmd | null;
  turn: PreparedTurn | null;
  route: Route;
  history: ReplayRow[];
  summary: string | null;
  priorAssistants: number;
  forcedCompaction: boolean;
  startedAt: number;
  ix: ReturnType<typeof getIndexes>;
}

// Kicked off as early as possible — it only needs userId + message, so it
// overlaps the user-message INSERT and history SELECT instead of stacking
// after them. .catch() at creation, not at the await site: this promise sits
// unawaited for a while, so a DB blip must be swallowed right here or Bun
// sees it as an unhandled rejection before anything ever awaits it. /teach
// never reads a matched teaching, so a turn that opens with it skips this.
function startTeachingMatch(userId: string, message: string, convId: string, teachCmd: TeachCmd | null): Promise<RankedTeaching[]> {
  if (teachCmd || !config.chatTeach) return Promise.resolve([] as RankedTeaching[]);
  return matchTeachings(userId, message).catch((err) => {
    captureError(err, {}, { stage: "teach_match", conversationId: convId });
    return [] as RankedTeaching[];
  });
}

// Compaction normally runs AFTER the answer (compact-turn.ts): the summary it
// writes is read by the NEXT turn, so making this one wait for it buys nothing.
//
// The exception is recovery: the provider rejected this conversation for
// length on an earlier turn, so the 4-chars/token estimate was wrong here
// and this turn cannot proceed until the prefix is smaller. It also
// overrides the failure cooldown — without a smaller prefix the turn is
// going to be rejected again anyway, so paying the timeout is the better
// bet. At most ONE forced compaction per rejection: context-overflow.ts owns
// that state machine; this file only asks the question and reports the
// outcome — and reports what actually happened, not what it intended:
// `forcedCompaction` is what the stream's error path passes as
// `forcedThisTurn`, so a forced compaction that a guard stood down (one was
// already in flight for this conversation) does not spend the one attempt
// per rejection.
async function compactIfRejected(convId: string, teachCmd: TeachCmd | null, obs: TurnObs, history: ReplayRow[], summary: string | null) {
  if (teachCmd || !shouldForceCompaction(convId)) return { history, summary, forcedCompaction: false };
  const compacted = await compactTurn({
    convId, rows: history, summary, call: makeOpenrouterJson(obs, "atlas-chat-summary"), obs, force: true,
  });
  return { history: compacted.rows, summary: compacted.summary, forcedCompaction: compacted.attempted };
}

// Telemetry for the pre-first-token judge — gated the same as the call
// itself, so a disabled/teach turn emits nothing. Counts and slugs only,
// never note text or ids beyond a count — this is a conversation-keyed
// event, not a user-content one.
function capturePrefetchJudge(turn: PreparedTurn | null, obs: TurnObs, message: string, teachHits: RankedTeaching[]): void {
  if (!turn || !config.chatPrefetchJudgeModel) return;
  const { judgement, jevLatencyMs } = turn;
  const teachKept = turn.teachings?.length ?? 0;
  captureEvent("chat_prefetch_judge", obs, {
    latency_ms: jevLatencyMs,
    timed_out: judgement === null && jevLatencyMs >= config.chatPrefetchJudgeDeadlineMs,
    complexity_p: judgement?.complexity ?? null,
    // routeCensuses IS the function the fact called, so this reports what
    // was actually injected — never a parallel re-derivation of the threshold
    // (concepts-prefetch.ts warns against one).
    census_fired: judgement && config.chatPrefetch ? routeCensuses(message, undefined, judgement.census) : [],
    teach_kept: teachKept,
    teach_dropped: teachHits.length - teachKept,
  });
}

// PostHog AI observability: one trace per turn, minted before compaction so a
// summary call shares it. distinctId is the CONVERSATION, not the signed-in
// user — semi-anonymous analytics: turns of one conversation stay grouped in
// PostHog, but no user identity is sent (userId stays DB-only). The SAME obs
// feeds the answer stream, the harness jsonCall (verifier), and error
// capture, so every generation AND every error of the turn lands in one
// trace. Route properties are filled in once prepareTurn has routed.
const newTurnObs = (convId: string): TurnObs => ({ distinctId: convId, traceId: crypto.randomUUID(), properties: {} });

async function loadReplay(userId: string, convId: string, body: ChatBody) {
  const teachCmd = config.chatTeach ? parseTeachCommand(body.message) : null;
  const teachingsPromise = startTeachingMatch(userId, body.message, convId, teachCmd);
  const { historyRows, history, summary } = await loadHistory(convId, body.message);
  const obs = newTurnObs(convId);
  const compacted = await compactIfRejected(convId, teachCmd, obs, history, summary);
  // Counted over the STORED rows, not the replayed ones: titling fires on
  // turns 1/4/10 of a conversation's life, and `history` drops everything a
  // compaction summarized away — counting that would re-title a long thread.
  const priorAssistants = historyRows.filter((m) => m.role === "assistant").length;
  return { teachCmd, teachingsPromise, obs, priorAssistants, ...compacted };
}

// Everything the model reads before its first token — Jev judgement, tier
// routing, system prompt, full history (plus a stable summary once the
// thread has been compacted), facts round, Jev-filtered /teach notes, the
// review round — is assembled by the one function the tool-choice eval also
// runs (turn-setup.ts). /teach never reaches any of it: no judgement, no
// routing (reason "teach"), no model input.
export async function prepareChatTurn(req: Request, userId: string, convId: string, body: ChatBody): Promise<ChatTurn> {
  const { teachingsPromise, ...replay } = await loadReplay(userId, convId, body);
  const ix = getIndexes();
  const teachHits = await teachingsPromise; // already overlapped the history queries
  const turn = replay.teachCmd
    ? null
    : await prepareTurn({ ix, message: body.message, history: replay.history, summary: replay.summary, pageContext: body.pageContext, teachHits });
  const route = turn?.route ?? TEACH_ROUTE;
  const startedAt = Date.now();
  replay.obs.properties.chat_tier = route.tier;
  replay.obs.properties.chat_route_reason = route.reason;
  capturePrefetchJudge(turn, replay.obs, body.message, teachHits);
  return { req, userId, convId, body, turn, route, startedAt, ix, ...replay };
}

// What the NEXT turn of this conversation will read, once this answer is
// stored. Used twice — by the meter and by the compaction that runs after the
// answer — so the size the user is shown and the rows we summarize can never
// describe different threads.
//
// `checksMeta` is this turn's own check rows, so the answer just produced
// carries its own review note (verify/review-note.ts). Attached HERE rather
// than in usedAfter so the compaction path gets the note-bearing rows too —
// otherwise the meter would count the note and the rows handed to compaction
// would not.
export function replayAfter(t: ChatTurn, answer: string, toolCalls: RecallToolCall[], checksMeta: CheckRowMeta[] = []): ReplayRow[] {
  return [
    ...t.history,
    {
      role: "assistant", content: answer, toolCalls,
      review: reviewNoteFromChecks(checksMeta.map((c) => ({ kind: c.kind, verdict: c.verdict, overall: c.overall }))),
    },
  ];
}

// That replay plus the standing prefix (context-compact.ts) is what the
// composer's meter shows, and it is the same arithmetic needsCompaction
// uses — a number that only grows until a compaction, rather than the
// measured prompt of one round, which rises with a turn's tool results and
// drops again on the next turn that needs none.
export function usedAfter(t: ChatTurn, answer: string, toolCalls: RecallToolCall[], checksMeta: CheckRowMeta[] = []): number {
  return contextUsedTokens(t.summary, replayAfter(t, answer, toolCalls, checksMeta));
}
