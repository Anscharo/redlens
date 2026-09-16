// GET /api/reports/search?q=… → { hits: string[] }
//
// Semantic lane for the /reports index. Lexical matching stays in the browser
// so a name/category/description substring is instant and works without the
// API. Paraphrases ("wallet addresses") are scored here with on-device
// ternlight — the same engine chat facts already load — so the client never
// fetches the 7 MB wasm for eleven cards.
//
// @ternlight/base is loaded lazily on first use, matching facts/similarity.ts:
// a static import would sit on the process boot path (index.ts → this module)
// and a WASM instantiate failure would take down health/MCP/static, not just
// this one route. A load failure returns empty hits; the client stays lexical.
import { json } from "./http.ts";
import { REPORT_INDEX_CARDS } from "../lib/reportCatalog.ts";
import {
  buildReportFieldVecs,
  cosineSim,
  hitsFromScores,
  normalizeReportIndexQuery,
  scoreReportQuery,
  type EmbedFn,
  type ReportIndexSearchResponse,
} from "../lib/reportIndexSearch.ts";

const MAX_Q = 200;

type Embedder = {
  embed: EmbedFn;
  fieldVecs: Map<string, Float32Array[]>;
};

let loading: Promise<Embedder | null> | null = null;

function loadEmbedder(): Promise<Embedder | null> {
  if (!loading) {
    loading = import("@ternlight/base")
      .then(({ embed }: { embed: EmbedFn }) => ({
        embed,
        fieldVecs: buildReportFieldVecs(REPORT_INDEX_CARDS, embed),
      }))
      .catch((err: unknown) => {
        console.error("[reports-search] @ternlight/base failed to load — semantic lane disabled:", err);
        return null;
      });
  }
  return loading;
}

export async function reportIndexSemanticHits(query: string): Promise<string[]> {
  const q = normalizeReportIndexQuery(query).slice(0, MAX_Q);
  if (!q) return [];
  const emb = await loadEmbedder();
  if (!emb) return [];
  return [...hitsFromScores(scoreReportQuery(q, emb.fieldVecs, emb.embed, cosineSim))];
}

export async function handleReportsSearch(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const hits = await reportIndexSemanticHits(q);
  return json({ hits } satisfies ReportIndexSearchResponse);
}
