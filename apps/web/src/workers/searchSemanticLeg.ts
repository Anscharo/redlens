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
  rrfFuse,
  semanticQueryOf,
  SEMANTIC_DEBOUNCE_MS,
  type SearchLane,
  type SemanticSearchResponse,
  type SemanticStrategy,
} from "@/lib/searchSemantic";

// How many semantically-scored documents to ask for. Larger than a screenful
// because under the woven strategy RRF can bury a semantic hit behind lexical
// ones — but not unbounded: every id costs a pgvector row on the server.
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
 * The text to embed for this query under this lane + strategy, or null when no
 * semantic round-trip should happen at all.
 */
export function semanticLegQuery(
  q: string,
  lane: SearchLane,
  sem: SemanticStrategy,
  lexicalCount: number,
  isKnownChainlog: (s: string) => boolean,
): string | null {
  if (lane === "graph") return null; // entities are the graph worker's job
  if (lane !== "semantic") {
    // Picking the semantic lane IS the request; otherwise the strategy decides.
    if (sem === "off") return null;
    if (sem === "fallback" && lexicalCount > 0) return null;
  }
  const trimmed = q.trim();
  if (isIdentifierQuery(trimmed, isKnownChainlog)) return null;
  return semanticQueryOf(trimmed);
}

/**
 * Fuse the lexical and semantic result lists by RRF (the woven strategy).
 *
 * A document found by both keeps its LEXICAL hit — that one carries the
 * highlighted title and the snippet built around the matched term, which a
 * semantic hit cannot reconstruct — and is additionally marked semantic, so the
 * UI can say it was found both ways. Semantic-only hits keep an empty
 * matchReason, which is what renders as the bare "semantic match" mark.
 */
export function weaveSemantic(lex: SearchHit[], sem: SearchHit[]): SearchHit[] {
  if (sem.length === 0) return lex;
  if (lex.length === 0) return sem;
  const fused = rrfFuse([lex.map((h) => h.id), sem.map((h) => h.id)]);
  const semById = new Map(sem.map((h) => [h.id, h]));
  const merged: SearchHit[] = lex.map((h) => {
    const s = semById.get(h.id);
    return s ? { ...h, semantic: true, semanticScore: s.semanticScore, viaTitle: s.viaTitle } : h;
  });
  const lexIds = new Set(lex.map((h) => h.id));
  for (const h of sem) if (!lexIds.has(h.id)) merged.push(h);
  // Stable sort on the fused score: equal scores keep insertion order, so the
  // lexical ranking survives wherever RRF has nothing to say.
  return merged
    .map((h, i) => ({ h, i, r: fused.get(h.id) ?? 0 }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map(({ h }) => h);
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
  /** The already-cleaned text to embed (see semanticLegQuery). */
  query: string;
  lane: SearchLane;
  /** Lexical hits to fuse with — empty on the semantic lane. */
  lexical: SearchHit[];
  /** performance.now() at the time the query arrived, for one honest duration. */
  startedAt: number;
  /** Scored ids → rendered hits. Owned by the worker (it holds the doc map). */
  hydrate: (scored: SemanticSearchResponse["hits"]) => SearchHit[];
  post: (msg: WorkerOutMessage) => void;
}

/** Debounce, fetch, fuse, post. Cancels any leg already scheduled or in flight. */
export function runSemanticLeg(run: SemanticLegRun): void {
  cancelSemanticLeg();
  semTimer = setTimeout(() => {
    semTimer = null;
    const ac = new AbortController();
    semAbort = ac;
    const url = `/api/search/semantic?q=${encodeURIComponent(run.query)}&k=${SEMANTIC_K}`;
    void fetch(url, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`semantic search: ${res.status}`);
        return (await res.json()) as SemanticSearchResponse;
      })
      .then((body) => {
        if (ac.signal.aborted) return;
        const sem = run.hydrate(Array.isArray(body.hits) ? body.hits : []);
        run.post({
          type: "results",
          id: run.id,
          hits: run.lane === "semantic" ? sem : weaveSemantic(run.lexical, sem),
          durationMs: performance.now() - run.startedAt,
          lane: run.lane,
          semantic: legStatus(body),
          ...(body.skipped ? { semanticNote: body.skipped } : {}),
        });
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
  }, SEMANTIC_DEBOUNCE_MS);
}
