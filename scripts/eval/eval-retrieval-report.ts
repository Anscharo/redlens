// Result types and console reporting for eval-retrieval.ts.
import type { AtlasNode } from "../../src/types.ts";
import type { RetrievalQuery } from "./eval-retrieval-queries.ts";
import { lexicalOverlap } from "./eval-retrieval-paraphrase.ts";
import type { metrics } from "./eval-retrieval-metrics.ts";
import { pctTimes } from "./eval-retrieval-rank.ts";
import { HYBRID, K, RERANK, RERANK_N, type BriefingArmName, type BriefingText } from "./eval-retrieval-flags.ts";

export type Metrics = Omit<ReturnType<typeof metrics>, "per_query">;
export interface ArmResult {
  policy: string;
  model: string;
  backend: string;
  rerank: string;
  collapse: boolean;
  hybrid: boolean;
  prefix: boolean;
  cap: number | null;
  crumb_depth: number | null;
  crumb_strategy: string | null;
  units: number;
  /** Arm name: none | s1 | s2 | s2docs. */
  briefings: BriefingArmName;
  /** Which text the block holds; null for `none`. */
  briefing_text: BriefingText | null;
  /** all | covered: the candidate pool and scored queries this arm ran over. */
  pool: "all" | "covered";
  query_embed_ms: { p50: number | null; p95: number | null };
  metrics: Metrics;
  /** Per scored query: id, slice, top-K hit (ancestors count), exact leaf hit. */
  per_query: ReturnType<typeof metrics>["per_query"];
  /** Leaf-rerank arms only: the paired control, ceiling, cost and latency. */
  rerank_detail?: unknown;
}

// Lexical leakage: how much of each question is already present verbatim in its own
// answer. High means the question is a restatement of the document, so BM25 wins it
// outright and the run says nothing about semantic retrieval. A slice near 1.00
// (39 of 40 icd-param queries once contained the answer text) measures string
// matching only. Printed per slice so that cannot return quietly.
export function printQueryDiagnostics(queries: RetrievalQuery[], docMap: Map<string, AtlasNode>): void {
  const bySlice = new Map<string, { sum: number; n: number; ctrl: boolean }>();
  for (const q of queries) {
    const target = docMap.get(q.relevant[0] ?? "");
    if (!target) continue;
    const ov = lexicalOverlap(q.query, `${target.title} ${target.content ?? ""}`);
    const b = bySlice.get(q.slice) ?? { sum: 0, n: 0, ctrl: false };
    b.sum += ov;
    b.n++;
    b.ctrl = b.ctrl || q.lexicalControl === true;
    bySlice.set(q.slice, b);
  }
  const parts = [...bySlice.entries()].map(([sl, b]) => `${sl} ${(b.sum / b.n).toFixed(2)}${b.ctrl ? "*" : ""}`);
  console.log(`lexical overlap by slice (* = deliberate lexical control): ${parts.join("  ")}`);
  const dupes = queries.length - new Set(queries.map((q) => q.query)).size;
  if (dupes > 0) console.log(`  ⚠ ${dupes} duplicate query strings — same question, different answers, unanswerable`);
  // Arm-differential coverage. A slice whose targets are treated identically by both
  // policies cannot measure the difference between them, however good its metrics
  // look: a kv-record gain on 3 of 24 differential queries is uninformative. Print it
  // up front so that failure mode is never silent.
  const differentialQs = queries.filter((q) => q.differential !== undefined);
  if (!differentialQs.length) return;
  const n = differentialQs.filter((q) => q.differential).length;
  console.log(
    `arm-differential coverage: ${n}/${differentialQs.length} flagged queries target docs the arms treat differently` +
      (n < differentialQs.length / 4 ? "  ⚠ too low to attribute any delta to the policy" : ""),
  );
}

const fmtDis = (d: number | null) => (d == null ? "-" : d.toFixed(3));

export function printArm(r: ArmResult, label: string, capLabel: string): void {
  const m = r.metrics;
  console.log(
    `  ${r.policy} cap=${capLabel} ${r.backend === "tfidf" ? "tfidf" : r.model} rerank=${RERANK} hybrid=${HYBRID} recall@${K}=${m.recall_at_k.toFixed(3)} exact=${m.exact_recall_at_k.toFixed(3)} disambig=${fmtDis(m.disambiguation_accuracy)} mrr=${m.mrr.toFixed(3)} briefings=${label} pool=${r.pool}`,
  );
}

export function printSlices(m: Metrics): void {
  for (const [sl, s] of Object.entries(m.slices)) {
    console.log(`    ${sl}: n=${s.n} recall=${s.recall_at_k.toFixed(3)} exact=${s.exact_recall_at_k.toFixed(3)} mrr=${s.mrr.toFixed(3)}`);
  }
}

interface RerankRun {
  control: ReturnType<typeof metrics>;
  ceilingHits: boolean[];
  ms: number[];
  scores: number[];
  cost: number;
}

// Leaf-rerank arms: the same N-list without reranking (the control), the ceiling,
// the cost and the latency. Returns the detail stored on the arm's result.
export function printRerankDetail(run: RerankRun): unknown {
  const c = run.control;
  const ceiling = run.ceilingHits.filter(Boolean).length / run.ceilingHits.length;
  const sorted = [...run.scores].sort((a, b) => a - b);
  const sp = (x: number) => sorted[Math.floor(x * (sorted.length - 1))]!.toFixed(2);
  console.log(
    `    control (same ${RERANK_N}-list, no rerank): recall@${K}=${c.recall_at_k.toFixed(3)} exact=${c.exact_recall_at_k.toFixed(3)} disambig=${fmtDis(c.disambiguation_accuracy)} mrr=${c.mrr.toFixed(3)}   exact ceiling@${RERANK_N}=${ceiling.toFixed(3)} (a relevant LEAF in the list; recall@K also credits ancestors)`,
  );
  console.log(
    `    rerank per query: p50 ${(pctTimes(run.ms, 50) ?? 0).toFixed(0)}ms p95 ${(pctTimes(run.ms, 95) ?? 0).toFixed(0)}ms   cost $${run.cost.toFixed(3)}   scores p10 ${sp(0.1)} p50 ${sp(0.5)} p90 ${sp(0.9)} (n=${sorted.length})`,
  );
  for (const [sl, x] of Object.entries(c.slices)) {
    console.log(`      control ${sl}: recall=${x.recall_at_k.toFixed(3)} exact=${x.exact_recall_at_k.toFixed(3)} mrr=${x.mrr.toFixed(3)}`);
  }
  return {
    pool: RERANK_N, ceiling_recall: ceiling, control: c, cost_usd: run.cost,
    rerank_ms: { p50: pctTimes(run.ms, 50), p95: pctTimes(run.ms, 95) },
  };
}
