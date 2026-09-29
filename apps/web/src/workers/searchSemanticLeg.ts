// The search worker's semantic leg: when to ask the backend, how to fuse what
// comes back, and the one in-flight request's lifecycle.
//
// Split out of search.worker.ts so the decisions are unit-testable without a
// worker global and without MiniSearch. Everything the leg needs from the
// worker (the doc map, the hit builder, `postMessage`) is passed in.
import type { SearchHit, SemanticLegStatus, WorkerOutMessage } from "@/types";
import { UUID_RE } from "@/lib/patterns";
import { isUuidPrefix } from "../lib/uuidSearch";
import {
  semanticQueryOf,
  trailingWord,
  SEMANTIC_DEBOUNCE_MS,
  SEMANTIC_PARTIAL_DEBOUNCE_MS,
  type SearchLane,
  type SemanticQuery,
  type SemanticSearchResponse,
  type SemanticStrategy,
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
 * What to ask the semantic backend for this query under this lane + strategy —
 * the text to embed plus any `in:` scope — or null for no round-trip at all.
 *
 * `lexicalCount` is a THUNK, not a number: only the fallback strategy needs it,
 * and on the semantic lane the lexical list is discarded anyway — so taking it
 * lazily is what lets the caller skip a whole-corpus MiniSearch run it would
 * throw away on every keystroke typed into that lane.
 */
export function semanticLegQuery(
  q: string,
  lane: SearchLane,
  sem: SemanticStrategy,
  lexicalCount: () => number,
  isKnownChainlog: (s: string) => boolean,
): SemanticQuery | null {
  if (lane === "graph") return null; // entities are the graph worker's job
  if (lane !== "semantic") {
    // Picking the semantic lane IS the request; otherwise the strategy decides.
    if (sem === "off") return null;
    if (sem === "fallback" && lexicalCount() > 0) return null;
  }
  const trimmed = q.trim();
  if (isIdentifierQuery(trimmed, isKnownChainlog)) return null;
  return semanticQueryOf(trimmed);
}


/**
 * What the reader's trailing word looks like:
 *   whole   — a finished word: an English word, or one this atlas uses as
 *             written. Either way there is nothing to wait for.
 *   partial — only the START of a word the atlas uses, and not a word itself,
 *             so it is probably still being typed.
 *   unknown — no atlas term starts with it and it is not an English word we
 *             know; nothing completes it, so waiting would achieve nothing.
 *
 * Only `partial` waits — and note that `unknown` does NOT. A query made of
 * words this atlas never uses is precisely what the meaning lane exists for,
 * and it must never be the case that phrasing a question in your own
 * vocabulary makes the search slower than quoting the atlas back at it.
 */
export type WordShape = "whole" | "partial" | "unknown";

/**
 * How long to wait after this keystroke before spending an embedding call.
 */
export function semanticDebounceMs(q: string, shapeOf: (word: string) => WordShape): number {
  const word = trailingWord(q);
  if (word === null) return SEMANTIC_DEBOUNCE_MS;
  return shapeOf(word) === "partial" ? SEMANTIC_PARTIAL_DEBOUNCE_MS : SEMANTIC_DEBOUNCE_MS;
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
  /** Keystroke pause before the request — see `semanticDebounceMs`. */
  debounceMs: number;
  /** Scored ids → rendered hits. Owned by the worker (it holds the doc map). */
  hydrate: (scored: SemanticSearchResponse["hits"]) => SearchHit[];
  post: (msg: WorkerOutMessage) => void;
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
    // Always a REPLACEMENT, never a merge. On the semantic lane the wording
    // list was never fetched; on the wording lane the leg only runs under the
    // fallback strategy, which by definition means wording returned nothing.
    // (Fusing the two was the `woven` strategy, dropped 2026-09-29.)
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

/** Debounce, fetch, fuse, post. Cancels any leg already scheduled or in flight. */
export function runSemanticLeg(run: SemanticLegRun): void {
  cancelSemanticLeg();
  semTimer = setTimeout(() => {
    semTimer = null;
    const ac = new AbortController();
    semAbort = ac;
    const url =
      `/api/search/semantic?q=${encodeURIComponent(run.query.query)}&k=${SEMANTIC_K}` +
      (run.query.scope ? `&in=${encodeURIComponent(run.query.scope)}` : "");
    void fetch(url, { signal: ac.signal })
      .then(async (res) => {
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
        });
      });
  }, run.debounceMs);
}
