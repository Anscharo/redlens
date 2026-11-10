// Best-answer reranker over the head of a fused search list: ONE Jev request
// per query, every candidate in the state, a Choice whose options are the
// candidates. The pick (and the little mass Jev spreads past it) moves up; every
// other candidate keeps its retrieval order, so a failed or slow call costs
// nothing but the wait. The eval scores this exact request
// (scripts/eval/eval-rerankers.ts imports it); its numbers are in the
// eval-retrieval.ts header.
import type { AtlasNode } from "../../types.ts";
import { askJev, withDeadline, type JevQuestion } from "../jev.ts";
import { JEV } from "../env/chat.ts";
import { captureError } from "../posthog-node.ts";
import { withTimeout } from "../retry.ts";
import { config } from "../config.ts";
import { createCache } from "../ttl-cache.ts";

export const rerankConfig = {
  /** "" turns the reranker off. */
  model: process.env.SEARCH_RERANK_MODEL ?? JEV,
  pool: Number(process.env.SEARCH_RERANK_POOL ?? 30),
  deadlineMs: Number(process.env.SEARCH_RERANK_DEADLINE_MS ?? 1500),
};

const BODY_CHARS = 1200;
const PATH_DEPTH = 4;

export interface CandidateText {
  path: string;
  title: string;
  body: string;
}

/**
 * What the reranker reads for one candidate. Ancestor titles first: which
 * product a near-identical parameter document belongs to is named 2-3 levels
 * up, and a thin parameter leaf carries nothing on its own.
 */
export function candidateText(id: string, docMap: Map<string, AtlasNode>): CandidateText {
  const n = docMap.get(id);
  if (!n) return { path: "", title: id, body: "" };
  const crumbs: string[] = [];
  let p = n.parentId ? docMap.get(n.parentId) : undefined;
  while (p && crumbs.length < PATH_DEPTH) {
    crumbs.unshift(p.title);
    p = p.parentId ? docMap.get(p.parentId) : undefined;
  }
  return { path: crumbs.join(" › "), title: `${n.doc_no} ${n.title}`, body: (n.content ?? "").replace(/\s+/g, " ").trim().slice(0, BODY_CHARS) };
}

/** Option keys c01…cNN, in input order; `none` absorbs the mass when nothing fits. */
export function choiceRequest(query: string, ids: string[], docMap: Map<string, AtlasNode>) {
  const keys = ids.map((_, i) => `c${String(i + 1).padStart(2, "0")}`);
  const candidates: Record<string, CandidateText> = {};
  const criteria: Record<string, string> = {};
  ids.forEach((id, i) => {
    const t = candidateText(id, docMap);
    candidates[keys[i]!] = t;
    criteria[keys[i]!] = `\`candidates.${keys[i]}\` — ${t.path ? `${t.path} › ` : ""}${t.title}`;
  });
  criteria.none = "No candidate answers the query.";
  const best: JevQuestion = {
    type: "choice",
    instructions: "Which candidate best answers `query`? Each option names an entry in `candidates`; read its `path` and `title` for which product or scope it belongs to, and its `body` for what it says.",
    criteria,
  };
  return { keys, state: { query, candidates }, questions: { best } };
}

/** Stable: equal scores keep the incoming (retrieval) order. */
export function sortByScore(ids: string[], scores: number[]): string[] {
  return ids
    .map((id, i) => ({ id, s: scores[i] ?? 0, i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.id);
}

export interface ChoiceRanking {
  ids: string[];
  /** One option probability per input id, in input order. */
  scores: number[];
  cost: number;
  ms: number;
}

/** One Jev Choice over `ids`. Throws on a failed or timed-out call. */
export async function rankByChoice(
  query: string,
  ids: string[],
  docMap: Map<string, AtlasNode>,
  opts: { model?: string; signal?: AbortSignal; lane: string },
): Promise<ChoiceRanking> {
  const t0 = performance.now();
  const req = choiceRequest(query, ids, docMap);
  const run = await askJev({ lane: opts.lane, model: opts.model, state: req.state, questions: req.questions, signal: opts.signal });
  const a = run.answers.best;
  if (a?.type !== "choice") throw new Error("rerank: Jev returned no choice");
  const scores = req.keys.map((k) => a.probabilities[k] ?? 0);
  return { ids: sortByScore(ids, scores), scores, cost: run.cost ?? 0, ms: performance.now() - t0 };
}

// Order of each recent (model, query, head) — a later page of the same search
// reads the order its first page used, so pages agree and Jev is paid once.
const orderCache = createCache<string[]>({ max: 256, lru: true });

async function headOrder(query: string, ids: string[], docMap: Map<string, AtlasNode>): Promise<string[]> {
  const { model, deadlineMs } = rerankConfig;
  const key = JSON.stringify([model, query, ids]);
  const hit = orderCache.get(key);
  if (hit) return hit;
  // The signal aborts the request; the race bounds the wait even when the
  // transport ignores the abort.
  const ranking = rankByChoice(query, ids, docMap, { model, lane: "search-rerank", signal: withDeadline(deadlineMs) });
  const { ids: order } = await withTimeout(ranking, deadlineMs, "rerank");
  orderCache.set(key, order);
  return order;
}

/**
 * Reorders the first `rerankConfig.pool` items of `items` by one Choice and
 * leaves the tail as it was. Never throws: with the reranker off (no model or
 * no OpenRouter key), fewer than two candidates, or a failed call, the items
 * come back unchanged with a reason. Only a failed call is captured.
 */
export async function rerankHead<T>(
  query: string,
  items: T[],
  idOf: (t: T) => string,
  docMap: Map<string, AtlasNode>,
): Promise<{ items: T[]; skipped?: string }> {
  const { model, pool } = rerankConfig;
  if (!model || !config.openrouterApiKey) return { items, skipped: "off" };
  const head = items.slice(0, pool);
  if (head.length < 2) return { items };
  try {
    const order = await headOrder(query, head.map(idOf), docMap);
    const byId = new Map(head.map((t) => [idOf(t), t]));
    return { items: [...order.map((id) => byId.get(id)!), ...items.slice(pool)] };
  } catch (err) {
    captureError(err, {}, { stage: "search_rerank", model, candidates: head.length });
    return { items, skipped: (err as Error).message.slice(0, 200) };
  }
}
