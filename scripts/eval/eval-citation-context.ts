// Full-context arm for eval-citation.ts (`--context full`).
//
// Sends the cited document with its ancestor titles and its whole subtree, plus
// the answer the claim came from. The default arm never imports this path, so
// its request bytes and cache keys stay unchanged.
import { buildCiteRequest, type CiteVerdict } from "../../src/server/chat/verify/cite-support.ts";
import { askJev, choiceOf, withDeadline } from "../../src/server/jev.ts";
import type { Indexes } from "../../src/server/retrieval/indexes.ts";
import { loadRecords, type CiteCase } from "./eval-citation-cases.ts";

export const SUBTREE_CAP_CHARS = 400_000;
const EVAL_TIMEOUT_MS = 60_000;

const CONTEXT_SENTENCE =
  " The state also holds `ancestors` (the titles of the cited document's parents, root first), `subtree` (the cited document's descendants in document order) and `answer` (the full reply the claim came from). These are context only. Judge ONLY whether the cited document, including its subtree, backs the claim.";

const answers = new Map(loadRecords().map(({ file, rec }) => [file, rec.answer ?? ""]));

function ancestorTitles(ix: Indexes, id: string): string[] {
  const out: string[] = [];
  for (let p = ix.docMap.get(id)?.parentId; p; p = ix.docMap.get(p)?.parentId) out.unshift(ix.docMap.get(p)?.title ?? "");
  return out;
}

/** Descendants in document order. Stops adding once the cap is reached, so the last and deepest nodes drop first. */
function subtreeOf(ix: Indexes, id: string): { nodes: { title: string; content: string }[]; truncated: boolean } {
  const nodes: { title: string; content: string }[] = [];
  let used = 0;
  let truncated = false;
  const walk = (parent: string): void => {
    for (const k of ix.childrenIndex.get(parent) ?? []) {
      if (truncated) return;
      const size = k.title.length + k.content.length;
      if (used + size > SUBTREE_CAP_CHARS) {
        truncated = true;
        return;
      }
      used += size;
      nodes.push({ title: k.title, content: k.content });
      walk(k.id);
    }
  };
  walk(id);
  return { nodes, truncated };
}

export function buildFullRequest(c: CiteCase, ix: Indexes, question: NonNullable<NonNullable<Parameters<typeof buildCiteRequest>[2]>["question"]>) {
  const base = buildCiteRequest(c, ix, { question });
  if (!base) return null;
  const sub = subtreeOf(ix, c.uuid);
  const answer = answers.get(c.source);
  const state = { ...(base.state as object), ancestors: ancestorTitles(ix, c.uuid), subtree: sub.nodes, ...(answer ? { answer } : {}) };
  const q = base.questions.support;
  return { state, questions: { support: { ...q, instructions: q.instructions + CONTEXT_SENTENCE } }, truncated: sub.truncated };
}

export async function judgeFull(req: { state: unknown; questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }> }, model: string): Promise<{ verdict: CiteVerdict | null; ms: number | null; cost: number }> {
  try {
    const run = await askJev({ lane: "cite-support", state: req.state, questions: req.questions, model, signal: withDeadline(EVAL_TIMEOUT_MS), timeoutMs: EVAL_TIMEOUT_MS });
    const ch = choiceOf(run, "support");
    return { verdict: (ch?.choice as CiteVerdict) ?? null, ms: run.latencyMs, cost: run.cost ?? 0 };
  } catch {
    return { verdict: null, ms: null, cost: 0 };
  }
}
