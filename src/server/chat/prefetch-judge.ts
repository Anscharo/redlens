// The ONE pre-first-token Jev request (2026-09-22 decision — see
// model-router.ts's header and docs/plans/jev-typesafe.md's "Research round
// 2026-09-22 — prefetch gating"). A single askJev call over the user's
// message (plus the /teach shortlist, when there is one) answers three
// routing questions at once — complexity, census, and per-note relevance —
// under a hard deadline that falls back to today's regex + on-device-
// similarity lanes on a miss. Question wording lives in prefetch-questions.ts
// (load-bearing — see that file's header); this module owns the request/
// response shape, the deadline, and the three shipped thresholds.
import { askJev, noulOf, withDeadline } from "../jev.ts";
import { captureError, type ErrorContext } from "../posthog-node.ts";
import { config } from "../config.ts";
import { type CensusSlug, CENSUS_SLUGS } from "../../lib/conceptsCensus.ts";
import type { RankedTeaching } from "./teach/match.ts";
import { PREFETCH_COMPLEXITY_QUESTION, PREFETCH_CENSUS_QUESTIONS, teachBookQuestion } from "./prefetch-questions.ts";
import type { JevQuestion } from "../jev.ts";

export interface PrefetchNote {
  id: string;
  subject: string | null;
  content: string;
}

export interface PrefetchJudgement {
  /** P(whole-corpus question). null only when the call succeeded but this one Noul didn't parse. */
  complexity: number | null;
  /** One P per census slug — every slug is always present, defaulting to 0 on a per-Noul parse miss (never a false fire, since 0 sits under every threshold). */
  census: Record<CensusSlug, number>;
  /** P per note id, ONLY for notes whose Noul parsed. A note absent here was not ruled on and callers must keep it (fail-open — see filterTeachingsByJev). */
  teach: Record<string, number>;
  latencyMs: number;
  costUsd: number | null;
  generationId: string | null;
}

// Held out 12/14 vs status quo's 4/14 at 0/76 labeled false fires; on 145 real
// dev messages it adds ~23 genuine whole-corpus questions today's lanes miss
// ("what are the most edited docs?", "show me all addresses carrying erc20
// balances"). Shipped as an OR with today's lanes (model-router.ts), never a
// replacement: a false fire here only routes to the strong model, which the
// 2026-08-21 bakeoff measured both better and faster, so it costs tokens, not
// correctness. Real traffic: strong-routed share goes ~17% -> ~35%.
export const JEV_COMPLEXITY_THRESHOLD = 0.58;

// Labeled 47/50 routed vs status quo 43/50, 0/152 labeled false fires; on 145
// real messages ZERO fires (the highest real top-slug P was 0.53), whereas
// today's similarity lane fired on 7 real messages with 0 correct — it no
// longer meets its own zero-real-false-fire bar. Top slugs at or above this
// threshold, capped at MAX_CENSUSES by the caller (concepts-prefetch.ts).
export const JEV_CENSUS_THRESHOLD = 0.6;

// A FILTER over today's shortlist (AND, never adds a note): the synthetic
// 20-pair set cut wrong injections 21 -> 5 of 109 while keeping 10/11 right
// ones. On the one real stored note it removed the single false injection
// (matched only on the word "say", P 0.09) and kept all 6 genuine ones.
// Evidence is thin (one real note) — this threshold is the least measured of
// the three.
export const JEV_TEACH_THRESHOLD = 0.5;

export async function judgePrefetch(params: {
  question: string;
  notes: PrefetchNote[];
  model?: string;
  signal?: AbortSignal;
  deadlineMs?: number;
  obs?: ErrorContext;
}): Promise<PrefetchJudgement | null> {
  // Resolved and checked BEFORE askJev, not left to askJev's own `params.model
  // || config.chatJevModel` fallback — that fallback exists for callers who
  // always want a Jev model, but this caller's "" means "the feature is off",
  // and askJev would otherwise silently run it on the shared default model.
  const model = params.model ?? config.chatPrefetchJudgeModel;
  if (!model) return null;

  const deadlineMs = params.deadlineMs ?? config.chatPrefetchJudgeDeadlineMs;
  const signal = withDeadline(deadlineMs, params.signal);

  const state: Record<string, unknown> = { message: params.question.slice(0, 2000) };
  if (params.notes.length > 0) {
    state.notes = params.notes.map((n) => ({ subject: n.subject, content: n.content }));
  }
  const questions: Record<string, JevQuestion> = { complexity: PREFETCH_COMPLEXITY_QUESTION, ...PREFETCH_CENSUS_QUESTIONS };
  params.notes.forEach((n, i) => {
    questions[`teach:${n.id}`] = teachBookQuestion(i);
  });

  try {
    const run = await askJev({ state, questions, model, signal, timeoutMs: deadlineMs });
    const census = {} as Record<CensusSlug, number>;
    for (const slug of CENSUS_SLUGS) census[slug] = noulOf(run, slug) ?? 0;
    const teach: Record<string, number> = {};
    for (const n of params.notes) {
      const p = noulOf(run, `teach:${n.id}`);
      if (p !== null) teach[n.id] = p; // omit on a per-Noul miss, never fabricate 0 — see PrefetchJudgement.teach
    }
    return {
      complexity: noulOf(run, "complexity"),
      census,
      teach,
      latencyMs: run.latencyMs,
      costUsd: run.cost,
      generationId: run.generationId,
    };
  } catch (err) {
    captureError(err, params.obs, { stage: "prefetch_judge", model });
    return null;
  }
}

/**
 * Keep only teachings Jev rated relevant. AND over today's shortlist, never
 * ADDS a note the lexical/ternlight lanes didn't already shortlist. A missing
 * judgement (Jev off, timed out, or errored) or a note the judgement didn't
 * rule on both fail OPEN — the note is kept, so a Jev outage degrades to
 * today's behavior rather than silently emptying the notebook.
 */
export function filterTeachingsByJev(hits: RankedTeaching[], judgement: PrefetchJudgement | null): RankedTeaching[] {
  if (!judgement) return hits;
  return hits.filter((h) => {
    const p = judgement.teach[h.id];
    return p === undefined || p >= JEV_TEACH_THRESHOLD;
  });
}
