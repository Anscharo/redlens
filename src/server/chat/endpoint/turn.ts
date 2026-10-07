// Everything POST /api/chat decides before the stream opens: the /teach
// branch, the replayed history, the prepared turn and the turn's trace.
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
import type { ConversationScope } from "../conversation-access.ts";

// /teach is its own path (review + persist, no atlas harness), so it never
// runs prepareTurn and records reason "teach".
const TEACH_ROUTE: Route = { tier: "default", reason: "teach" };

type TeachCmd = NonNullable<ReturnType<typeof parseTeachCommand>>;
type PreparedTurn = Awaited<ReturnType<typeof prepareTurn>>;
// privacyMode: the conversation holds private preview text (conversation-access.ts).
type TurnObs = { distinctId: string; traceId: string; properties: Record<string, unknown>; privacyMode: boolean };

export interface ChatTurn {
  req: Request;
  userId: string;
  convId: string;
  body: ChatBody;
  scope: ConversationScope;
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

// Started early to overlap the history queries. .catch() at creation: the
// promise sits unawaited, so a DB blip would otherwise be an unhandled rejection.
function startTeachingMatch(userId: string, message: string, convId: string, teachCmd: TeachCmd | null): Promise<RankedTeaching[]> {
  if (teachCmd || !config.chatTeach) return Promise.resolve([] as RankedTeaching[]);
  return matchTeachings(userId, message).catch((err) => {
    captureError(err, {}, { stage: "teach_match", conversationId: convId });
    return [] as RankedTeaching[];
  });
}

// Compaction normally runs after the answer; it runs first only to recover
// from a provider length rejection (context-overflow.ts owns that state).
// `forcedCompaction` reports what actually ran, so a compaction a guard stood
// down does not spend the one attempt per rejection.
async function compactIfRejected(convId: string, teachCmd: TeachCmd | null, obs: TurnObs, history: ReplayRow[], summary: string | null) {
  if (teachCmd || !shouldForceCompaction(convId)) return { history, summary, forcedCompaction: false };
  const compacted = await compactTurn({
    convId, rows: history, summary, call: makeOpenrouterJson(obs, "atlas-chat-summary"), obs, force: true,
  });
  return { history: compacted.rows, summary: compacted.summary, forcedCompaction: compacted.attempted };
}

// Counts and slugs only: this is a conversation-keyed event, never user content.
function capturePrefetchJudge(turn: PreparedTurn | null, obs: TurnObs, message: string, teachHits: RankedTeaching[]): void {
  if (!turn || !config.chatPrefetchJudgeModel) return;
  const { judgement, jevLatencyMs } = turn;
  const teachKept = turn.teachings?.length ?? 0;
  captureEvent("chat_prefetch_judge", obs, {
    latency_ms: jevLatencyMs,
    timed_out: judgement === null && jevLatencyMs >= config.chatPrefetchJudgeDeadlineMs,
    complexity_p: judgement?.complexity ?? null,
    // The same function the fact called, so this reports what was injected.
    census_fired: judgement && config.chatPrefetch ? routeCensuses(message, undefined, judgement.census) : [],
    teach_kept: teachKept,
    teach_dropped: teachHits.length - teachKept,
  });
}

// One PostHog trace per turn, shared by every generation and error. distinctId
// is the CONVERSATION, never the user: userId stays DB-only.
const newTurnObs = (convId: string, privacyMode: boolean): TurnObs => ({
  distinctId: convId,
  traceId: crypto.randomUUID(),
  properties: {},
  privacyMode,
});

async function loadReplay(userId: string, convId: string, body: ChatBody, privacyMode: boolean) {
  const teachCmd = config.chatTeach ? parseTeachCommand(body.message) : null;
  const teachingsPromise = startTeachingMatch(userId, body.message, convId, teachCmd);
  const { historyRows, history, summary } = await loadHistory(convId, body.message);
  const obs = newTurnObs(convId, privacyMode);
  const compacted = await compactIfRejected(convId, teachCmd, obs, history, summary);
  // Counted over STORED rows: `history` drops compacted rows, which would re-title.
  const priorAssistants = historyRows.filter((m) => m.role === "assistant").length;
  return { teachCmd, teachingsPromise, obs, priorAssistants, ...compacted };
}

// The model's input is assembled by prepareTurn, the function the tool-choice
// eval also runs. /teach skips it entirely.
export async function prepareChatTurn(req: Request, userId: string, convId: string, body: ChatBody, scope: ConversationScope): Promise<ChatTurn> {
  const { teachingsPromise, ...replay } = await loadReplay(userId, convId, body, scope.privacyMode);
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
  return { req, userId, convId, body, scope, turn, route, startedAt, ix, ...replay };
}

// What the NEXT turn will read. Shared by the meter and post-answer compaction
// so both describe the same thread, review note included.
export function replayAfter(t: ChatTurn, answer: string, toolCalls: RecallToolCall[], checksMeta: CheckRowMeta[] = []): ReplayRow[] {
  return [
    ...t.history,
    {
      role: "assistant", content: answer, toolCalls,
      review: reviewNoteFromChecks(checksMeta.map((c) => ({ kind: c.kind, verdict: c.verdict, overall: c.overall }))),
    },
  ];
}

// The composer's meter: the same arithmetic needsCompaction uses, so it only
// grows until a compaction rather than tracking one round's prompt.
export function usedAfter(t: ChatTurn, answer: string, toolCalls: RecallToolCall[], checksMeta: CheckRowMeta[] = []): number {
  return contextUsedTokens(t.summary, replayAfter(t, answer, toolCalls, checksMeta));
}
