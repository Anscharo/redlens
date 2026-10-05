// Scoring and leaf attribution for eval-retrieval.ts.
import type { AtlasNode } from "../../src/types.ts";
import { isDocNoDescendant, rewriteSemanticHit, type EmbedUnit } from "../../src/server/retrieval/embed-units.ts";
import type { RetrievalQuery } from "./eval-retrieval-queries.ts";
import type { PoolRow } from "./eval-retrieval-rank.ts";

type Acc = { n: number; recall: number; mrr: number; exact: number; exactMrr: number };
const newAcc = (): Acc => ({ n: 0, recall: 0, mrr: 0, exact: 0, exactMrr: 0 });

// Index of the first hit that is relevant, or -1. With `ancestors`, a hit that is an
// ancestor of a relevant leaf counts too.
function hitAt(hits: string[], rel: Set<string>, ancestors: boolean, docMap: Map<string, AtlasNode>): number {
  for (let i = 0; i < hits.length; i++) {
    const id = hits[i]!;
    if (rel.has(id)) return i;
    if (!ancestors) continue;
    const n = docMap.get(id);
    if (!n) continue;
    for (const r of rel) {
      const leaf = docMap.get(r);
      if (leaf && isDocNoDescendant(leaf.doc_no, n.doc_no)) return i;
    }
  }
  return -1;
}

function addQuery(a: Acc, found: number, exact: number): void {
  a.n++;
  if (found >= 0) {
    a.recall++;
    a.mrr += 1 / (found + 1);
  }
  if (exact >= 0) {
    a.exact++;
    a.exactMrr += 1 / (exact + 1);
  }
}

export function metrics(ranked: string[][], queries: RetrievalQuery[], docMap: Map<string, AtlasNode>) {
  const total = newAcc();
  let disN = 0;
  let disExact = 0;
  const bySlice: Record<string, Acc> = {};
  const perQuery: { id: string; slice: string; hit: 0 | 1; exact: 0 | 1 }[] = [];
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i]!;
    const rel = new Set(q.relevant);
    const found = hitAt(ranked[i]!, rel, true, docMap);
    const exact = hitAt(ranked[i]!, rel, false, docMap);
    perQuery.push({ id: q.id, slice: q.slice, hit: found >= 0 ? 1 : 0, exact: exact >= 0 ? 1 : 0 });
    addQuery(total, found, exact);
    if (q.slice === "icd-disambiguation") {
      disN++;
      if (exact >= 0) disExact++;
    }
    addQuery((bySlice[q.slice] ??= newAcc()), found, exact);
  }
  const n = queries.length || 1;
  const slices: Record<string, { n: number; recall_at_k: number; mrr: number; exact_recall_at_k: number; exact_mrr: number }> = {};
  for (const [sl, b] of Object.entries(bySlice)) {
    slices[sl] = { n: b.n, recall_at_k: b.recall / b.n, mrr: b.mrr / b.n, exact_recall_at_k: b.exact / b.n, exact_mrr: b.exactMrr / b.n };
  }
  return {
    n: queries.length,
    recall_at_k: total.recall / n,
    mrr: total.mrr / n,
    exact_recall_at_k: total.exact / n,
    exact_mrr: total.exactMrr / n,
    disambiguation_accuracy: disN ? disExact / disN : null,
    slices,
    per_query: perQuery,
  };
}

// `collapse` is the --collapse flag: without lexical hits, treat the ranked ids as
// the lexical list. `semantic` is the leaf scorer mirroring what search.ts builds in
// production. Without it this harness would measure lexical attribution (~34%
// accurate) while production runs the residual-embedding one (~51%), and a policy
// comparison would be decided by the wrong attribution, which is the larger effect.
export function attributeRank(
  query: string,
  ranked: PoolRow[],
  units: EmbedUnit[],
  docMap: Map<string, AtlasNode>,
  k: number,
  collapse: boolean,
  lexHits: { id: string; doc_no: string }[] = [],
  semantic?: (id: string) => number | undefined,
): string[] {
  const byAnchor = new Map(units.map((u) => [u.anchorId, u]));
  const lex =
    lexHits.length > 0
      ? lexHits
      : collapse
        ? ranked.map((r) => ({ id: r.id, doc_no: docMap.get(r.id)?.doc_no ?? "" }))
        : [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const r of ranked) {
    const rw = rewriteSemanticHit(query, r.id, byAnchor.get(r.id)?.memberIds, lex, docMap, semantic);
    if (seen.has(rw.id)) continue;
    seen.add(rw.id);
    ids.push(rw.id);
    if (ids.length >= k) break;
  }
  return ids;
}
