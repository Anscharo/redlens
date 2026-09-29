// GET /api/search/semantic?q=…&k=…&type=… → { hits, skipped, available }
//
// The reader's semantic search lane. It is a thin adapter, not a second
// retrieval stack: the scoring, the grouped-anchor leaf attribution and the
// relevance floor all come from src/server/retrieval/search.ts — the same code
// chat's hybrid retrieval runs. What this adds is the shape the BROWSER needs.
//
// Only ids and scores cross the wire. The client already holds docs.json (the
// search worker keeps the whole corpus in memory), so sending titles, types or
// snippets would ship a second copy of data it has and would duplicate the
// worker's highlighting. Consequence: the response is a few KB whatever k is.
//
// The lexical leg runs here too, and is thrown away. That is deliberate and
// cheap (in-memory MiniSearch, no network): `attributeSemanticHits` uses the
// lexical doc numbers to pick WHICH member of a grouped embedding anchor a hit
// should be attributed to, so dropping it would degrade exactly the ICD-param
// case grouping was adopted for. The client re-derives its own lexical list.
import { json } from "./http.ts";
import { config } from "./config.ts";
import { getIndexes } from "./retrieval/indexes.ts";
import {
  runLexical,
  runSemantic,
  attributeSemanticHits,
  buildLeafScorer,
  filterByType,
  type Via,
} from "./retrieval/search.ts";
import {
  MAX_SEMANTIC_QUERY,
  inScope,
  semanticWorthAsking,
  type SemanticSearchHit,
  type SemanticSearchResponse,
} from "../lib/searchSemantic.ts";

/** Default k, and the ceiling a caller can ask for. */
export const SEMANTIC_K_DEFAULT = 60;
export const SEMANTIC_K_MAX = 200;

/**
 * Can this deployment answer the lane at all? An embedding key is the one hard
 * requirement — `runSemantic` returns nothing without it, and reports that as
 * config state rather than as a degraded leg. Surfaced to the client so the UI
 * can disable the toggle instead of offering a lane that silently finds zero.
 */
export function semanticSearchAvailable(): boolean {
  return !!config.openrouterApiKey;
}

export function clampK(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return SEMANTIC_K_DEFAULT;
  return Math.min(Math.round(n), SEMANTIC_K_MAX);
}

export async function semanticDocSearch(
  query: string,
  opts: { k?: number; type?: string; scope?: string } = {},
): Promise<SemanticSearchResponse> {
  const available = semanticSearchAvailable();
  const q = query.trim().slice(0, MAX_SEMANTIC_QUERY);
  if (!available || !semanticWorthAsking(q)) return { hits: [], skipped: null, available };

  const k = opts.k ?? SEMANTIC_K_DEFAULT;
  const ix = getIndexes();
  // Over-fetch when a type filter is in play: the filter runs AFTER leaf-pick
  // (a grouped parent can carry a different type from the leaf it resolves to),
  // so filtering a k-sized list would return fewer than k matching hits.
  // Over-fetch when anything filters AFTER the nearest-neighbour cut: a type
  // filter runs post-leaf-pick, and an `in:` scope admits ancestor anchors that
  // may attribute to a leaf outside it. Both shrink the list after the SQL LIMIT.
  const fetchK = opts.type || opts.scope ? Math.min(k * 4, SEMANTIC_K_MAX) : k;
  const semResult = await runSemantic(ix, q, opts.type, fetchK, opts.scope);
  const lex = runLexical(ix, q, opts.type, fetchK);
  const attributed = attributeSemanticHits(
    q,
    lex,
    semResult.hits,
    ix,
    await buildLeafScorer(q, semResult.hits, ix),
  );

  // The SQL scope clause is permissive on purpose (it keeps ancestor anchors);
  // this is the exact test, and it runs on the LEAF the hit was attributed to,
  // which is the id the reader will actually open.
  const typed = filterByType(attributed, ix, opts.type);
  const scoped = opts.scope
    ? typed.filter((h) => {
        const n = ix.docMap.get(h.id);
        return !!n && inScope(n.doc_no, opts.scope!);
      })
    : typed;
  return { hits: toWireHits(scoped, ix.docMap, k), skipped: semResult.skipped, available };
}

/**
 * Attributed hits → the wire shape, deduped and capped.
 *
 * Split out and pure so the three things that go wrong here are testable
 * without a database, an embedding provider or a process-wide module mock.
 */
export function toWireHits(
  attributed: readonly { id: string; score: number; via?: Via }[],
  docMap: ReadonlyMap<string, unknown>,
  k: number,
): SemanticSearchHit[] {
  const seen = new Set<string>();
  const hits: SemanticSearchHit[] = [];
  for (const h of attributed) {
    if (hits.length >= k) break;
    // Dedup AFTER attribution: two grouped anchors can resolve onto the SAME
    // leaf, and the client keys its rows by id — a duplicate would render twice.
    if (seen.has(h.id)) continue;
    // A doc the client cannot resolve is worse than a missing hit: it would
    // occupy one of k slots and then be dropped during hydration.
    if (!docMap.has(h.id)) continue;
    seen.add(h.id);
    hits.push({
      id: h.id,
      score: h.score,
      // `match_scope: "group"` means the anchor itself matched, so its title IS
      // this hit's title and "via <title>" would just repeat it. Only a child
      // attribution has something to explain.
      ...(h.via?.match_scope === "child" ? { viaTitle: h.via.group_title } : {}),
    });
  }
  return hits;
}

export async function handleSemanticSearch(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const q = params.get("q") ?? "";
  const type = params.get("type") ?? undefined;
  const scope = params.get("in")?.toUpperCase() || undefined;
  try {
    const body = await semanticDocSearch(q, { k: clampK(params.get("k")), type, scope });
    return json(body);
  } catch (err) {
    // A thrown failure here means something outside the semantic leg broke
    // (indexes not loaded yet, for instance) — runSemantic swallows its own.
    // Answer 200 with an empty, reason-carrying body: the client's lexical
    // results are already on screen and must not be replaced by an error.
    console.warn(`[search-semantic] ${(err as Error).message}`);
    return json({
      hits: [],
      skipped: (err as Error).message,
      available: semanticSearchAvailable(),
    } satisfies SemanticSearchResponse);
  }
}
