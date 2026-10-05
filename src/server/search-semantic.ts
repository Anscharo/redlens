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
import { runLexical, runSemantic, filterByType, fuseBriefings, type Via } from "./retrieval/search.ts";
import { lexicalResidual, attributeSemanticHits, buildLeafScorer } from "./retrieval/leaf-attribution.ts";
import { spendSemanticBudget } from "./search-semantic-limit.ts";
import { getSessionUser } from "./session.ts";
import { vectorsCurrent } from "./vectors-current.ts";
import {
  MAX_SEMANTIC_QUERY,
  inScope,
  plausibleScope,
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

// One model (`EMBED_MODEL`) serves every semantic caller. This set decides only
// whether the search bar shows the meaning pill under it: the model's query
// embed must be quick enough to answer while the reader types.
// qwen3-embedding-8b is not: its hosts take 7 to 36 s for one call in ten
// (docs/research/embedding-model-comparison.md).
const PILL_MODELS = new Set(["google/gemini-embedding-2"]);

/**
 * Can the route answer right now? It also needs every stored vector to come
 * from the running model (`vectorsCurrent`), or a query is scored against
 * another model's vectors.
 */
export function semanticRouteReady(): boolean {
  return semanticSearchAvailable() && vectorsCurrent.current();
}

/**
 * Does the search bar offer the meaning lane? The page reads this at serve
 * time and hides the pill when it is false.
 */
export function semanticLaneShown(): boolean {
  return PILL_MODELS.has(config.embedModel) && semanticRouteReady();
}

/**
 * Would answering this query actually SPEND anything?
 *
 * One rule, read by two callers: the search itself, to return early, and the
 * budget gate, so a query that was never going to embed — too short, a
 * deployment with no key, or vectors still being re-embedded — cannot burn a token
 * that a real search needs.
 */
export function wouldSpendEmbed(query: string): boolean {
  return semanticRouteReady() && semanticWorthAsking(query.trim().slice(0, MAX_SEMANTIC_QUERY));
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
  const available = semanticRouteReady();
  const q = query.trim().slice(0, MAX_SEMANTIC_QUERY);
  if (!wouldSpendEmbed(query)) return { hits: [], skipped: null, available };

  const k = opts.k ?? SEMANTIC_K_DEFAULT;
  const ix = getIndexes();
  // Over-fetch when anything filters AFTER the nearest-neighbour cut: a type
  // filter runs post-leaf-pick, and an `in:` scope admits ancestor anchors that
  // may attribute to a leaf outside it. Both shrink the list after the SQL LIMIT.
  const fetchK = opts.type || opts.scope ? Math.min(k * 4, SEMANTIC_K_MAX) : k;
  // The lexical leg FIRST, and not only because attribution reads its doc
  // numbers: it is in-memory MiniSearch, so the residual that leaf attribution
  // scores members against can be built from it here and embedded in the
  // query's own round trip. Building it after the semantic call, from that
  // call's anchor titles, costs a second ~2.3s embed — half the request. See
  // `lexicalResidual`.
  const lex = runLexical(ix, q, opts.type, fetchK);
  const semResult = await runSemantic(ix, q, opts.type, fetchK, opts.scope, lexicalResidual(q, lex, ix.docMap));
  const attributed = attributeSemanticHits(
    q,
    lex,
    semResult.hits,
    ix,
    await buildLeafScorer(semResult.hits, semResult.vecs),
  );

  // The SQL scope clause is permissive on purpose (it keeps ancestor anchors);
  // this is the exact test, and it runs on the LEAF the hit was attributed to,
  // which is the id the reader will actually open.
  // One more ranking, fused once with the attributed leaves: a thin document
  // (a one-line parameter) is found by what its briefing says it is. No extra
  // embed call: the briefing statement reuses the query vector.
  const fused = fuseBriefings(attributed, semResult.briefingHits);
  const typed = filterByType(fused, ix, opts.type);
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

/**
 * The 429 for an exhausted budget. `scope` says whose budget ran out: "shared"
 * (signed out, where signing in gets the reader their own) or "user" (their own
 * hourly allowance), so the client can say which.
 */
function semanticRateLimited(retryAfterSeconds: number, scope: "shared" | "user"): Response {
  return new Response(JSON.stringify({ error: "rate_limited", scope, retryAfterSeconds }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(retryAfterSeconds) },
  });
}

export async function handleSemanticSearch(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const q = params.get("q") ?? "";
  const type = params.get("type") ?? undefined;
  const asked = params.get("in")?.toUpperCase() || undefined;
  // A scope that is not doc-number shaped is dropped, not passed down: the SQL
  // uses it as a LIKE pattern, so `in=%` would widen the clause to every row
  // and pay for the exact scan before `inScope` narrowed the answer back to
  // nothing. Dropping it answers the same empty list without the scan.
  const scope = asked && plausibleScope(asked) ? asked : undefined;
  const badScope = asked !== undefined && scope === undefined;
  // Ahead of the budget: a request this route refuses outright must not spend a
  // token other readers are sharing.
  if (badScope) {
    return json({
      hits: [],
      skipped: "that in: scope is not a document number",
      available: semanticSearchAvailable(),
    } satisfies SemanticSearchResponse);
  }
  // Before the work, not after: the point of the gate is that the embed never
  // happens. A query that would not have spent anything is not charged for.
  if (wouldSpendEmbed(q)) {
    const session = config.usersEnabled ? await getSessionUser(req) : null;
    const budget = spendSemanticBudget(Date.now(), session?.user.id);
    if (!budget.ok) return semanticRateLimited(budget.retryAfter, budget.scope);
  }
  try {
    const body = await semanticDocSearch(q, { k: clampK(params.get("k")), type, scope });
    return json(body);
  } catch (err) {
    // A thrown failure here means something outside the semantic leg broke
    // (indexes not loaded yet, for instance) — runSemantic swallows its own.
    // Answer 200 with an empty, reason-carrying body: the client's lexical
    // results are already on screen and must not be replaced by an error.
    console.warn(`[search-semantic] ${(err as Error).message}`);
    // The detail stays in the log. This route is public and `skipped` is shown
    // to the reader verbatim, so the thrown message — which can be a Postgres
    // or driver string, not a provider one — must not travel in the body.
    return json({
      hits: [],
      skipped: "meaning search is unavailable right now",
      available: semanticRouteReady(),
    } satisfies SemanticSearchResponse);
  }
}
