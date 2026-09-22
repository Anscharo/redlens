// Everything that shapes a chat turn BEFORE the first model call, in one place:
// the pre-first-token Jev judgement, tier routing, the system prompt, the
// windowed history, the facts round and the /teach notes round. The SSE route
// (chat.ts) and the tool-choice eval (scripts/eval/eval-tools.ts) both call
// prepareTurn, so an eval measures the turn production actually sends — the
// older evals built only a system prompt + one user message, which is a
// different system (no facts, no routing, no page context, no history).
//
// What stays OUT of here, in chat.ts: auth, the rate/commons/concurrency gates,
// conversation + message persistence, the /teach command path, and the
// per-user /teach lookup (matchTeachings) — anything that needs a signed-in
// user or the DB. Their results come in as arguments (history, teachHits).
import type OpenAI from "openai";
import type { Indexes } from "../retrieval/indexes.ts";
import { config } from "../config.ts";
import { routeTier, resolveTierModels, citationStyleFor, iterationsForTier, type ModelTier, type Route } from "./model-router.ts";
import { buildSystemPrompt, type PageContext } from "./system-prompt.ts";
import { runFacts, factRound, type FactInjection } from "../facts/registry.ts";
import { windowHistory, type HistoryRow } from "./chat-history.ts";
import { judgePrefetch, filterTeachingsByJev, type PrefetchJudgement } from "./prefetch-judge.ts";
import { teachingRound } from "./teach/inject.ts";
import type { RankedTeaching } from "./teach/match.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface TurnInput {
  ix: Indexes;
  message: string;
  /** The conversation exactly as chat.ts loads it: every stored row, oldest
   *  first, INCLUDING the user message just persisted for this turn. Both the
   *  history window and follow-up routing read it that way. */
  history: HistoryRow[];
  pageContext?: PageContext;
  /** This user's matched /teach notes (chat.ts's DB lookup). An eval has no
   *  user, so it passes none. */
  teachHits?: RankedTeaching[];
  /** The Jev call, injectable for tests. Defaults to judgePrefetch. */
  judge?: typeof judgePrefetch;
  /** Evals only: run this tier's model chain whatever routing says, so a
   *  tier's model is measured on every question. The prompt still follows
   *  the model that runs (citation style, round budget). */
  forceTier?: ModelTier;
}

export interface PreparedTurn {
  /** The tier this turn runs on (the routed one unless forceTier was set). */
  route: Route;
  /** What production routing chose. Equal to `route` unless forceTier was set. */
  routed: Route;
  models: string[];
  maxIterations: number;
  messages: Msg[];
  facts: FactInjection | null;
  judgement: PrefetchJudgement | null;
  jevLatencyMs: number;
  /** Notes kept after the Jev filter, or null when none is injected. */
  teachings: RankedTeaching[] | null;
}

export async function prepareTurn(input: TurnInput): Promise<PreparedTurn> {
  const { ix, message, history, pageContext } = input;
  const teachHits = input.teachHits ?? [];
  const judge = input.judge ?? judgePrefetch;

  // Pre-first-token Jev judgement. model-router.ts's header comment and
  // config.ts's chatPrefetchJudgeModel are the two places this exception is
  // explained. ONE request, ≤chatPrefetchJudgeDeadlineMs (default 600ms),
  // read before routeTier so its complexity score can join tier routing
  // this same turn.
  const jevStartedAt = Date.now();
  const judgement = config.chatPrefetchJudgeModel
    ? await judge({
        question: message,
        notes: teachHits.map((h) => ({ id: h.id, subject: h.subject, content: h.content })),
      })
    : null;
  const jevLatencyMs = Date.now() - jevStartedAt;

  // Per-turn tier routing: pick the model chain before any LLM work.
  // Follow-up turns (an assistant reply already in history) never route fast
  // on brevity alone — see model-router.ts. This runs BEFORE the system prompt
  // is built because the citation format the prompt asks for depends on which
  // model will read it.
  const priorAssistants = history.filter((m) => m.role === "assistant").length;
  const routed = routeTier(message, { followUp: priorAssistants > 0, jevComplexity: judgement?.complexity });
  const route: Route = input.forceTier ? { tier: input.forceTier, reason: "forced" } : routed;
  const models = resolveTierModels(route.tier);
  const maxIterations = iterationsForTier(route.tier);

  // The DB keeps the full conversation; the model gets a windowed replay
  // (recent turns verbatim, older ones truncated, hard char budget) so long
  // conversations never grow the per-round context without bound.
  const messages: Msg[] = [
    { role: "system", content: buildSystemPrompt(ix, pageContext, citationStyleFor(models[0]), undefined, maxIterations) },
    ...windowHistory(history).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  // Facts (facts/registry.ts): deterministic, pure-code knowledge blocks that
  // fire on the question — glossary definitions, entity rows, concept censuses,
  // app documentation. Seeded as a synthetic tool round after the user message
  // so a question they already answer needs ONE request instead of tool-round →
  // answer-round. Injects nothing on a miss; the harness treats what they do
  // inject as ordinary turn evidence. jevCensus (set only when the judge ran)
  // REPLACES the census fact's own similarity lane rather than adding to it
  // — see concepts-prefetch.ts's routeCensuses.
  const facts = config.chatPrefetch
    ? runFacts({ ix, question: message, page: pageContext, jevCensus: judgement?.census })
    : null;
  if (facts) messages.push(...factRound(message, facts));

  // Matched /teach notes for THIS user only, Jev-filtered when a judgement
  // landed (a miss keeps today's whole shortlist — filterTeachingsByJev
  // fails open).
  const kept = filterTeachingsByJev(teachHits, judgement);
  const teachings = kept.length > 0 ? kept : null;
  if (teachings) messages.push(...teachingRound(message, teachings));

  return { route, routed, models, maxIterations, messages, facts, judgement, jevLatencyMs, teachings };
}
