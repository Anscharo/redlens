// Rerankers for the retrieval eval's `--rerank jev|qwen3` arms.
//
// Both score the SAME final leaf-doc candidate list against the SAME text
// (`candidateText`), so the bakeoff measures the model and not the input. The
// list is what the shipped path would return for k = --rerank-pool: attributed
// leaves for semantic-only, the RRF fusion for --hybrid. Recall@N of that list
// is the reranker's ceiling; the eval prints it beside every arm.
import type { AtlasNode } from "../../src/types.ts";
import { askJev, withDeadline } from "../../src/server/jev.ts";

export type Reranker = "none" | "bm25" | "jev" | "jev-neutral" | "jev-score" | "jev-choice" | "qwen3";

export interface RerankOutcome {
  ids: string[];
  /** One score per input id, in input order (noul for Jev, P(yes) for Qwen). */
  scores: number[];
  ms: number;
  /** Dollars, Jev only (the endpoint reports it inline). */
  cost: number;
}

const BODY_CHARS = 1200;
const PATH_DEPTH = 4;

/**
 * What a reranker reads for one candidate. Ancestor titles first: the ICD
 * disambiguation slice is decided by a product name that lives 2-3 levels up,
 * and a thin parameter leaf carries nothing on its own.
 */
export function candidateText(id: string, docMap: Map<string, AtlasNode>): { path: string; title: string; body: string } {
  const n = docMap.get(id);
  if (!n) return { path: "", title: id, body: "" };
  const crumbs: string[] = [];
  let p = n.parentId ? docMap.get(n.parentId) : undefined;
  while (p && crumbs.length < PATH_DEPTH) {
    crumbs.unshift(p.title);
    p = p.parentId ? docMap.get(p.parentId) : undefined;
  }
  return {
    path: crumbs.join(" › "),
    title: `${n.doc_no} ${n.title}`,
    body: (n.content ?? "").replace(/\s+/g, " ").trim().slice(0, BODY_CHARS),
  };
}

/** Stable: equal scores keep the incoming (retrieval) order. */
export function sortByScore(ids: string[], scores: number[]): string[] {
  return ids
    .map((id, i) => ({ id, s: scores[i] ?? 0, i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.id);
}

const JEV_QUESTION = {
  type: "noul" as const,
  instructions: "Does `candidate` answer `query`? Read `candidate.path` and `candidate.title` for which product or scope the document belongs to.",
  criteria: {
    true: "The candidate states the rule, value, definition, address or fact the query asks about, for the product or scope the query names.",
    false: "The candidate is on a related topic, is a parent, sibling or index of the answer, or is the same template filled in for a different product or scope.",
  },
};

// The first question's false-criteria name "a parent, sibling or index of the
// answer", which is the correct answer for the hub and directory slices. This
// variant asks only whether the document is the one the query is looking for.
const JEV_QUESTION_NEUTRAL = {
  type: "noul" as const,
  instructions: "Is `candidate` the document someone asking `query` is looking for? `candidate.path` and `candidate.title` say which product or scope it belongs to.",
  criteria: {
    true: "This document is what the query asks for: the rule, value, definition, address, or the section or directory the query names, for the product or scope the query names.",
    false: "A different subject, or the same kind of document for a different product or scope.",
  },
};

// Graded relevance: a Score over ordered levels, ranked by the expected
// position (`score`, 0..3). Where a Noul collapses "the section the query
// names" and "the exact rule" into one yes, the levels keep them apart, and a
// candidate that is merely on-topic sits below both.
const JEV_QUESTION_SCORE = {
  type: "score" as const,
  instructions: "How well does `candidate` answer `query`? `candidate.path` and `candidate.title` say which product or scope it belongs to.",
  criteria: [
    "Unrelated: a different subject, or the same kind of document for a different product or scope.",
    "On the topic, but not what was asked: a neighbouring rule, an ancestor or child of the answer, or background.",
    "Partly answers it: the section or directory the query names, or a document that states part of the rule, value or definition asked for.",
    "Answers it: this document states the rule, value, definition, address or fact the query asks about, for the product or scope the query names.",
  ],
};

const JEV_CONCURRENCY = 12;

/** One request per (query, candidate): no request sees another candidate. */
export async function rerankJev(query: string, ids: string[], docMap: Map<string, AtlasNode>, question: object = JEV_QUESTION): Promise<RerankOutcome> {
  const t0 = performance.now();
  const scores = new Array<number>(ids.length).fill(0);
  let cost = 0;
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const i = next++;
      const run = await askJev({
        state: { query, candidate: candidateText(ids[i]!, docMap) },
        questions: { answers: question },
        signal: withDeadline(20_000),
      });
      const a = run.answers.answers;
      scores[i] = a?.type === "noul" ? a.noul : a?.type === "score" ? a.score : 0;
      cost += run.cost ?? 0;
    }
  };
  await Promise.all(Array.from({ length: Math.min(JEV_CONCURRENCY, ids.length) }, worker));
  return { ids: sortByScore(ids, scores), scores, ms: performance.now() - t0, cost };
}

/**
 * Comparative: ONE request per query with every candidate in the state and a
 * Choice whose options are the candidates. Candidates are judged against each
 * other, which pairwise scoring cannot do, and the request count drops from 30
 * to 1 per query. Ranked by the option probabilities; `none` absorbs the mass
 * when nothing fits so the distribution is not forced onto a wrong candidate.
 */
export async function rerankJevChoice(query: string, ids: string[], docMap: Map<string, AtlasNode>): Promise<RerankOutcome> {
  const t0 = performance.now();
  const keys = ids.map((_, i) => `c${String(i + 1).padStart(2, "0")}`);
  const candidates: Record<string, { path: string; title: string; body: string }> = {};
  const criteria: Record<string, string> = {};
  ids.forEach((id, i) => {
    const t = candidateText(id, docMap);
    candidates[keys[i]!] = t;
    criteria[keys[i]!] = `\`candidates.${keys[i]}\` — ${t.path ? `${t.path} › ` : ""}${t.title}`;
  });
  criteria.none = "No candidate answers the query.";
  const run = await askJev({
    state: { query, candidates },
    questions: {
      best: {
        type: "choice",
        instructions: "Which candidate best answers `query`? Each option names an entry in `candidates`; read its `path` and `title` for which product or scope it belongs to, and its `body` for what it says.",
        criteria,
      },
    },
    signal: withDeadline(60_000),
  });
  const a = run.answers.best;
  const probs = a?.type === "choice" ? a.probabilities : {};
  const scores = keys.map((k) => probs[k] ?? 0);
  return { ids: sortByScore(ids, scores), scores, ms: performance.now() - t0, cost: run.cost ?? 0 };
}

// Qwen3-Reranker's own template (model card): a system line fixing the answer
// to yes/no, then Instruct / Query / Document, then the assistant turn opened
// with an empty think block. Score = P(yes) over the {yes, no} pair at the
// next token. Served by a local Ollama in raw mode so the GGUF's chat template
// does not rewrite the prompt.
const QWEN_INSTRUCT = "Given a question about the Sky Atlas governance documents, judge whether the Document answers the Query";
const QWEN_MODEL = process.env.EVAL_QWEN_RERANKER ?? "dengcao/Qwen3-Reranker-4B:Q8_0";
const OLLAMA = process.env.OLLAMA_HOST ?? "http://localhost:11434";

export function qwenPrompt(query: string, doc: { path: string; title: string; body: string }): string {
  const document = `${doc.path}\n${doc.title}\n${doc.body}`;
  return (
    '<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".<|im_end|>\n' +
    `<|im_start|>user\n<Instruct>: ${QWEN_INSTRUCT}\n<Query>: ${query}\n<Document>: ${document}<|im_end|>\n` +
    "<|im_start|>assistant\n<think>\n\n</think>\n\n"
  );
}

/**
 * P(yes) from the next-token top-logprobs. The GGUF spreads mass over casing
 * variants ("No" -1.02, "no" -1.60 observed), so each side sums its variants.
 * Neither side present counts as 0.
 */
export function yesProbability(top: { token: string; logprob: number }[]): number {
  let yes = 0;
  let no = 0;
  for (const t of top) {
    const tok = t.token.trim().toLowerCase();
    if (tok === "yes") yes += Math.exp(t.logprob);
    else if (tok === "no") no += Math.exp(t.logprob);
  }
  return yes + no === 0 ? 0 : yes / (yes + no);
}

// /api/generate with raw:true — the OpenAI-compatible endpoint applied the chat
// template and returned logprobs: null on Ollama 0.20.4.
async function qwenScore(prompt: string): Promise<number> {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: QWEN_MODEL, prompt, raw: true, stream: false, logprobs: true, top_logprobs: 10,
      options: { num_predict: 1, temperature: 0 },
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { logprobs?: { top_logprobs?: { token: string; logprob: number }[] }[] };
  const top = body.logprobs?.[0]?.top_logprobs;
  if (!top) throw new Error("ollama returned no logprobs — see eval-rerankers.ts qwenScore");
  return yesProbability(top);
}

/** Sequential on purpose: the shared query prefix stays in the KV cache. */
export async function rerankQwen3(query: string, ids: string[], docMap: Map<string, AtlasNode>): Promise<RerankOutcome> {
  const t0 = performance.now();
  const scores: number[] = [];
  for (const id of ids) scores.push(await qwenScore(qwenPrompt(query, candidateText(id, docMap))));
  return { ids: sortByScore(ids, scores), scores, ms: performance.now() - t0, cost: 0 };
}

export async function rerank(kind: Reranker, query: string, ids: string[], docMap: Map<string, AtlasNode>): Promise<RerankOutcome> {
  if (kind === "jev") return rerankJev(query, ids, docMap);
  if (kind === "jev-neutral") return rerankJev(query, ids, docMap, JEV_QUESTION_NEUTRAL);
  if (kind === "jev-score") return rerankJev(query, ids, docMap, JEV_QUESTION_SCORE);
  if (kind === "jev-choice") return rerankJevChoice(query, ids, docMap);
  if (kind === "qwen3") return rerankQwen3(query, ids, docMap);
  return { ids, scores: [], ms: 0, cost: 0 };
}
