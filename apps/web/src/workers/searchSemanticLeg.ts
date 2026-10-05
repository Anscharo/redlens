// The search worker's semantic leg: when to ask the backend, how to fuse what
// comes back, and the one in-flight request's lifecycle.
//
// Split out of search.worker.ts so the decisions are unit-testable without a
// worker global and without MiniSearch. Everything the leg needs from the
// worker (the doc map, the hit builder, `postMessage`) is passed in.
import type { SearchHit, SemanticLegStatus, SemanticLimit, WorkerOutMessage } from "@/types";
import { UUID_RE } from "@/lib/patterns";
import { isUuidPrefix } from "../lib/uuidSearch";
import {
  semanticQueryOf,
  SEMANTIC_DEBOUNCE_MS,
  type SearchLane,
  type SemanticQuery,
  type SemanticSearchResponse,
} from "@/lib/searchSemantic";

// How many semantically-scored documents to ask for. A few screenfuls, so the
// list is worth scrolling — but not unbounded: every id costs a pgvector row.
export const SEMANTIC_K = 60;

// Sky chainlog id shape, e.g. MCD_VAT. A doc number for the fast exact-lookup
// path, e.g. "A.1.2", "A.1.2.3.4", "NR-12".
export const CHAINLOG_RE = /^[A-Z][A-Z0-9_]{2,}$/;
export const DOC_NO_RE = /^[A-Z][A-Z0-9]*(?:\.\w+)+$|^NR-\d+$/i;

/**
 * Identifier queries never get a semantic leg. A UUID, a doc number or a
 * chainlog id is a NAVIGATION request with one right answer the lexical search
 * already returns exactly; scoring it by meaning can only add noise, and it
 * would spend an embedding call on a lookup that was already correct.
 */
export function isIdentifierQuery(trimmed: string, isKnownChainlog: (s: string) => boolean): boolean {
  return (
    UUID_RE.test(trimmed) ||
    isUuidPrefix(trimmed) ||
    DOC_NO_RE.test(trimmed) ||
    (CHAINLOG_RE.test(trimmed) && isKnownChainlog(trimmed))
  );
}

/**
 * What to ask the semantic backend for this query on this lane — the text to
 * embed plus any `in:` scope — or null for no round-trip at all.
 *
 * Only the `semantic` lane asks. Picking that lane IS the request; on every
 * other lane the reader asked for a different index and gets that index, so a
 * wording search that finds nothing says so (and offers a spelling correction)
 * next to a pill offering the other one.
 */
export function semanticLegQuery(
  q: string,
  lane: SearchLane,
  isKnownChainlog: (s: string) => boolean,
): SemanticQuery | null {
  if (lane !== "semantic") return null;
  const trimmed = q.trim();
  if (isIdentifierQuery(trimmed, isKnownChainlog)) return null;
  return semanticQueryOf(trimmed);
}

/** What the response says about the leg's own health. */
export function legStatus(body: SemanticSearchResponse): SemanticLegStatus {
  if (!body.available) return "unavailable";
  return body.skipped ? "skipped" : "done";
}

// One in-flight semantic request at a time. A new query cancels the pending
// debounce AND aborts a request already on the wire — otherwise a slow reply
// for an abandoned query would land after the current one and replace correct
// results with stale ones (the id check on the main thread catches most of
// that, but not two messages racing under the same id).
let semTimer: ReturnType<typeof setTimeout> | null = null;
let semAbort: AbortController | null = null;

export function cancelSemanticLeg(): void {
  if (semTimer !== null) clearTimeout(semTimer);
  semTimer = null;
  semAbort?.abort();
  semAbort = null;
}

export interface SemanticLegRun {
  id: number;
  /** The already-split request: text to embed, plus any `in:` scope. */
  query: SemanticQuery;
  lane: SearchLane;
  /** Lexical hits to fuse with — empty on the semantic lane. */
  lexical: SearchHit[];
  /** performance.now() at the time the query arrived, for one honest duration. */
  startedAt: number;
  /** Scored ids → rendered hits. Owned by the worker (it holds the doc map). */
  hydrate: (scored: SemanticSearchResponse["hits"]) => SearchHit[];
  post: (msg: WorkerOutMessage) => void;
  /**
   * Set when the text does not look like words (wordShape.ts): when the pause
   * ends, this answers instead of the request. Judged at the same moment a
   * request would be sent, so a word still being typed is never reported.
   */
  hold?: () => void;
}

// ─── scored-id cache ────────────────────────────────────────────────────────
//
// Keyed by the cleaned query text, which is all the request is made of (k is a
// constant; the type filter stands the lane down entirely, see semanticQueryOf).
// So the SAME text asked for on a different lane is the same answer, and
// flipping between the pills must not re-embed, re-query pgvector, or make the
// reader wait out the debounce again.
//
// Scope is this worker, which useSearch tears down and rebuilds whenever the
// data-source base changes — so an atlas bump or a preview switch gets a fresh
// worker and a fresh cache, and nothing here can serve ids from another commit.
const CACHE_MAX = 50;
/** The response, plus what it COST to fetch — see `postFused` on why. */
interface CachedLeg {
  body: SemanticSearchResponse;
  durationMs: number;
}
const cache = new Map<string, CachedLeg>();

/** Test seam: drop everything this worker has scored. */
export function clearSemanticCache(): void {
  cache.clear();
}

/** Cache key. The scope narrows the result set, so it belongs in the key. */
function cacheKey(q: SemanticQuery): string {
  return q.scope ? `${q.scope}\u0000${q.query}` : q.query;
}

function remember(query: string, entry: CachedLeg): void {
  // A DEGRADED answer is never cached. `skipped` means the embed timed out or
  // the provider erred on this attempt — caching it would pin a transient
  // failure to this query for the life of the worker, and the next lane flip
  // would report a stale outage instead of retrying.
  if (entry.body.skipped) return;
  cache.delete(query); // re-insert so Map iteration order is LRU
  cache.set(query, entry);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

/**
 * Build and post the finished message — the one post path.
 *
 * `durationMs` is what the search COST, not how long this call took. A replay
 * from cache is ~1 ms, and reporting that would make the time on screen change
 * every time the reader flipped lanes and came back — the number would look
 * like a measurement of the click rather than of the search.
 */
function postFused(run: SemanticLegRun, body: SemanticSearchResponse, durationMs: number): void {
  const sem = run.hydrate(Array.isArray(body.hits) ? body.hits : []);
  run.post({
    type: "results",
    id: run.id,
    // Always a REPLACEMENT, never a merge: the leg runs on the meaning lane
    // alone, where the wording list was never fetched. Fusing the two lists
    // reads worse than either on its own.
    hits: sem,
    durationMs,
    lane: run.lane,
    semantic: legStatus(body),
    ...(body.skipped ? { semanticNote: body.skipped } : {}),
  });
}

/**
 * Answer straight from the cache when this query has already been scored, and
 * say whether it did. A hit skips the debounce as well as the request: the
 * whole point is that a lane flip feels instant, and there is nothing to wait
 * for. The caller must not post its own interim "pending" message when this
 * returns true — the answer is already final.
 */
export function answerFromCache(run: SemanticLegRun): boolean {
  const key = cacheKey(run.query);
  const entry = cache.get(key);
  if (!entry) return false;
  cache.delete(key); // touch: most recently used goes last
  cache.set(key, entry);
  postFused(run, entry.body, entry.durationMs);
  return true;
}

/** A 429 from the route: which budget ran out, in words the reader can act on. */
class SemanticLimitError extends Error {
  readonly scope: SemanticLimit;
  constructor(message: string, scope: SemanticLimit) {
    super(message);
    this.scope = scope;
  }
}

async function limitError(res: Response): Promise<SemanticLimitError> {
  const body = (await res.json().catch(() => ({}))) as { scope?: string; retryAfterSeconds?: number };
  if (body.scope !== "user") return new SemanticLimitError("the meaning index is busy — try again in a moment", "shared");
  const wait = Math.max(1, Number(body.retryAfterSeconds) || Number(res.headers.get("retry-after")) || 1);
  const when = wait < 90 ? `${wait} s` : `${Math.ceil(wait / 60)} min`;
  return new SemanticLimitError(`you have reached your hourly meaning-search limit — try again in ${when}`, "user");
}

/** Debounce, fetch, fuse, post. Cancels any leg already scheduled or in flight. */
export function runSemanticLeg(run: SemanticLegRun): void {
  cancelSemanticLeg();
  semTimer = setTimeout(() => {
    semTimer = null;
    if (run.hold) return run.hold();
    const ac = new AbortController();
    semAbort = ac;
    const url =
      `/api/search/semantic?q=${encodeURIComponent(run.query.query)}&k=${SEMANTIC_K}` +
      (run.query.scope ? `&in=${encodeURIComponent(run.query.scope)}` : "");
    void fetch(url, { signal: ac.signal })
      .then(async (res) => {
        if (res.status === 429) throw await limitError(res);
        if (!res.ok) throw new Error(`semantic search: ${res.status}`);
        return (await res.json()) as SemanticSearchResponse;
      })
      .then((body) => {
        if (ac.signal.aborted) return;
        const durationMs = performance.now() - run.startedAt;
        remember(cacheKey(run.query), { body, durationMs });
        postFused(run, body, durationMs);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        // The lexical half is already on screen (or, on the semantic lane,
        // nothing is) — report the degradation and keep what we have rather
        // than replacing results with an error state.
        run.post({
          type: "results",
          id: run.id,
          hits: run.lexical,
          durationMs: performance.now() - run.startedAt,
          lane: run.lane,
          semantic: "skipped",
          semanticNote: err instanceof Error ? err.message : String(err),
          ...(err instanceof SemanticLimitError ? { semanticLimit: err.scope } : {}),
        });
      });
  }, SEMANTIC_DEBOUNCE_MS);
}
