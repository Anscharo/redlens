// atlas_search: the lexical leg, the semantic leg with leaf attribution, their
// fusion, and the hybrid rerank, cut to one page.
import type { Indexes, AtlasNode } from "../../retrieval/indexes.ts";
import { runLexical, runSemantic, mergeForMode, filterByType, buildAgentSnippet, extractPhrases, matchesPhrases, type MergedHit, type SemanticResult } from "../../retrieval/search.ts";
import { lexicalResidual, attributeSemanticHits, buildLeafScorer } from "../../retrieval/leaf-attribution.ts";
import { pageOf, poolSize } from "../../retrieval/result-page.ts";
import { rerankConfig, rerankHead } from "../../retrieval/rerank.ts";
import { livenessOf, withLivenessHint, type ToolResult } from "./tools.ts";

export interface SearchArgs {
  query: string;
  k: number;
  offset?: number;
  type?: string;
  mode: "lexical" | "semantic" | "hybrid";
}

type Mode = SearchArgs["mode"];
type Row = { m: MergedHit; n: AtlasNode };

// The lexical leg is synchronous in-memory MiniSearch, so nothing is lost by
// running it first — and leaf attribution's residual, built from its titles,
// then rides in the query's own embed round trip rather than buying a second
// one (see `lexicalResidual`). `semantic` mode still computes it for that
// residual, and still keeps it out of the results.
async function fusedHits(ix: Indexes, query: string, type: string | undefined, mode: Mode, fetchK: number) {
  const lexAll = runLexical(ix, query, type, fetchK);
  const lex = mode === "semantic" ? [] : lexAll;
  const semResult =
    mode === "lexical"
      ? ({ hits: [], briefingHits: [], skipped: null } satisfies SemanticResult)
      : await runSemantic(
          ix, query, type, fetchK, undefined, lexicalResidual(query, lexAll, ix.docMap),
          // runSemantic reports a degraded leg in `skipped` rather than
          // throwing, so this catch is defensive only — and it keeps the reason
          // instead of discarding it.
        ).catch((err): SemanticResult => ({ hits: [], briefingHits: [], skipped: (err as Error).message }));
  const sem = attributeSemanticHits(query, lex, semResult.hits, ix, await buildLeafScorer(semResult.hits, semResult.vecs));
  const merged = filterByType(mergeForMode(mode, lex, sem, semResult.briefingHits), ix, type);
  const rows = merged.map((m) => ({ m, n: ix.docMap.get(m.id) })).filter((r): r is Row => !!r.n);
  return { rows, lexCount: lexAll.length, semanticSkipped: semResult.skipped };
}

const toResult = (ix: Indexes, query: string) => ({ m, n }: Row) => ({
  id: n.id,
  doc_no: n.doc_no,
  title: n.title,
  type: n.type,
  depth: n.depth,
  // Verbatim: this is a tool result an agent quotes from and is graded on.
  snippet: buildAgentSnippet(n.content, query),
  score: m.rrf_score || m.score,
  sources: m.sources,
  ...(m.via ? { via: m.via } : {}),
  ...livenessOf(ix, n.id),
});

// Pages are cut whole to the call's result budget (output-budget.ts resultBudget).
export async function atlasSearch(ix: Indexes, { query, k, offset = 0, type, mode }: SearchArgs): Promise<ToolResult> {
  const { phrases, casePhrases } = extractPhrases(query);
  const hasPhrases = phrases.length > 0 || casePhrases.length > 0;
  const fetchK = poolSize(offset, k, mode === "lexical" && !hasPhrases);
  const { rows, lexCount, semanticSkipped } = await fusedHits(ix, query, type, mode, fetchK);
  const filtered = hasPhrases ? rows.filter(({ n }) => matchesPhrases(n.title, n.content, phrases, casePhrases)) : rows;
  // Hybrid only: the measured lane (rerank.ts). A page starting past the pool
  // is untouched by it, so it pays no call. Pages fetched with the same k fuse
  // the same head and read its cached order, so they agree.
  const rerank = mode === "hybrid" && offset < rerankConfig.pool;
  const ordered = rerank ? (await rerankHead(query, filtered, ({ m }) => m.id, ix.docMap)).items : filtered;
  // poolCut: the lexical leg filled its pool. Semantic mode reports no cut: its
  // legs stop at hnsw.ef_search whatever the pool, so a larger k ranks no
  // deeper; the tool description says so instead.
  const { rows: results, fields } = pageOf(ordered, { offset, k }, toResult(ix, query), { poolCut: mode !== "semantic" && lexCount >= fetchK });
  // Only present when the requested mode actually wanted a semantic leg (a
  // pure lexical search never runs one, so there's nothing to report skipping).
  const skipped = mode !== "lexical" && semanticSkipped ? { semantic_skipped: semanticSkipped } : {};
  const envelope = { count: results.length, ...fields, mode, phrase_filter: [...phrases, ...casePhrases], ...skipped, results };
  return withLivenessHint(envelope, results);
}
