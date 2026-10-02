// The worker-side half of the semantic lane: the parts that need the search
// worker's own state (its MiniSearch index, its corpus, its hit renderer) and
// so cannot live in searchSemanticLeg.ts with the lane's decisions and fusion.
//
// Each function takes that state as an argument rather than reading a module
// global, which is what makes them testable against a real index without
// booting a worker.
import type MiniSearch from "minisearch";
import type { AtlasNode, SearchHit, SemanticLegStatus, WorkerOutMessage } from "@/types";
import type { SearchLane, SemanticSearchResponse } from "@/lib/searchSemantic";
import { buildSnippet } from "@/lib/searchHighlight";
import { MINISEARCH_OPTIONS } from "@/lib/searchOptions";
import { isCommonWord } from "./commonWords";
import {
  answerFromCache,
  runSemanticLeg,
  semanticDebounceMs,
  semanticLegQuery,
  type WordShape,
} from "./searchSemanticLeg";

/** A lexical run, with what it cost. */
export interface LexicalRun {
  hits: SearchHit[];
  durationMs: number;
}

/**
 * One-entry memo over `search`, keyed by query text.
 *
 * Switching lane re-sends the SAME query text against a different index, so
 * without this every flip between the pills pays for another whole-corpus
 * MiniSearch pass — which for a broad query is the slowest thing on the page.
 * One result set is held, and it is the same array the main thread is already
 * rendering.
 *
 * `durationMs` is remembered with it for the same reason `postFused` remembers
 * the leg's: a memo hit costs ~0 ms, and reporting that would make the time on
 * screen change every time the reader flipped lanes and came back.
 */
export function createLexicalMemo(search: (q: string) => SearchHit[]): (q: string) => LexicalRun {
  let last: { q: string; run: LexicalRun } | null = null;
  return (q) => {
    if (last?.q !== q) {
      const t0 = performance.now();
      const hits = search(q);
      last = { q, run: { hits, durationMs: performance.now() - t0 } };
    }
    return last.run;
  };
}

interface TermTree {
  has(key: string): boolean;
  atPrefix(prefix: string): { keys(): Iterator<string> };
}

/**
 * Is `word` finished, or is the reader still typing it?
 *
 * Two dictionaries, asked in this order, because they fail in opposite
 * directions. The English list knows "home" and "care" are whole words but has
 * never heard of "facilitator" or "usds"; the atlas's own term index knows
 * every word the corpus uses but only those, so it reads an ordinary English
 * word it happens not to use as the beginning of one it does. A word is
 * finished if EITHER says so.
 *
 * The atlas half reads MiniSearch's term dictionary, which is a radix tree:
 * `has` is one walk down the word and `atPrefix(...).keys().next()` stops at
 * the first term under it, so the probe costs nothing like a search — which
 * matters, because it runs on every keystroke and its whole job is to decide
 * whether to do corpus-sized work.
 *
 * `_index` is declared `protected` rather than public, so this is the one place
 * that reaches for it, behind a shape check that degrades to "unknown" (the
 * permissive answer: search now) if a MiniSearch upgrade ever moves it. The
 * worker test pins the behaviour against a real index, so that upgrade fails
 * the suite rather than quietly disabling the wait.
 *
 * The word is normalised through the index's OWN `processTerm`, so the probe
 * cannot disagree with the dictionary it is reading about what a term looks
 * like. A token that normalises away (under two characters) counts as partial:
 * a one-letter word is a word in progress.
 */
export function wordShapeIn(idx: MiniSearch | null, word: string): WordShape {
  if (isCommonWord(word)) return "whole";
  const tree = (idx as unknown as { _index?: TermTree } | null)?._index;
  if (!tree || typeof tree.has !== "function" || typeof tree.atPrefix !== "function") return "unknown";
  const processed = MINISEARCH_OPTIONS.processTerm?.(word, "content");
  const term = typeof processed === "string" ? processed : null;
  if (!term) return "partial";
  try {
    if (tree.has(term)) return "whole";
    return tree.atPrefix(term).keys().next().done === false ? "partial" : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * A spelling correction for a query that found nothing, or undefined.
 *
 * MiniSearch's own `autoSuggest` over the indexed terms, with two corrections
 * applied on top. It can return SEVERAL near terms for one query word
 * ("facilitater" -> "facilitators facilitator"), so the suggestion is trimmed
 * to the word count the reader typed. And every candidate is re-run through
 * `search` before it is offered: a "did you mean" that also finds nothing is
 * worse than staying quiet, and fuzzy term matching alone cannot promise the
 * corrected phrase matches any document.
 */
export function didYouMean(
  idx: MiniSearch | null,
  q: string,
  search: (q: string) => SearchHit[],
): string | undefined {
  if (!idx) return undefined;
  const trimmed = q.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  let suggestions: { suggestion: string }[];
  try {
    suggestions = idx.autoSuggest(trimmed, { fuzzy: 0.2, prefix: false }).slice(0, 3);
  } catch {
    return undefined; // a query shape autoSuggest can't parse is not an error here
  }
  for (const s of suggestions) {
    const parts = s.suggestion.split(/\s+/).filter(Boolean);
    for (const cand of [parts.slice(0, words.length).join(" "), s.suggestion]) {
      if (!cand || cand.toLowerCase() === trimmed.toLowerCase()) continue;
      if (search(cand).length > 0) return cand;
    }
  }
  return undefined;
}

/**
 * Turn scored ids into rendered hits, marked as semantic.
 *
 * Deliberately UNhighlighted, and the snippet is the document's opening rather
 * than a window around a matched term. Nothing about the wording matched, so
 * there is no term to centre on — and highlighting the query's words anyway
 * marks whatever stopwords happen to occur ("to", "are"), which both looks
 * broken and asserts a wording match the row's own label denies. A document
 * found by BOTH legs keeps its lexical hit, highlighting included; see
 * `weaveSemantic`.
 *
 * `toHit` is the worker's own renderer, passed in because it closes over the
 * corpus structures that compute a hit's labels.
 */
export function hydrateSemantic(
  scored: SemanticSearchResponse["hits"],
  docs: Record<string, AtlasNode>,
  toHit: (doc: AtlasNode, score: number, snippet: string) => SearchHit,
): SearchHit[] {
  const out: SearchHit[] = [];
  for (const s of scored) {
    const doc = docs[s.id];
    if (!doc) continue; // scored a doc these artifacts don't have (sha skew)
    const hit = toHit(doc, s.score, buildSnippet(doc.content, [], [], []));
    hit.semantic = true;
    hit.semanticScore = s.score;
    if (s.viaTitle) hit.viaTitle = s.viaTitle;
    out.push(hit);
  }
  return out;
}

/** Everything `answerQuery` needs from the worker that owns the corpus. */
export interface QueryDeps {
  index: () => MiniSearch | null;
  search: (q: string) => SearchHit[];
  lexicalFor: (q: string) => LexicalRun;
  hydrate: (scored: SemanticSearchResponse["hits"]) => SearchHit[];
  knowsChainlog: (id: string) => boolean;
  post: (msg: WorkerOutMessage) => void;
}

/**
 * Answer one `query` message on the lane it names.
 *
 * One query can post TWO `results` messages under one id — the lexical half
 * with `semantic: "pending"`, then the fused set — so a consumer must accept a
 * second reply rather than reading it as stale.
 */
export function answerQuery(msg: { id: number; q: string; lane?: SearchLane }, deps: QueryDeps): void {
  const startedAt = performance.now();
  const lane: SearchLane = msg.lane ?? "lexical";
  // Lexical is still needed on the semantic lane as its escape hatch: for a
  // query the leg declines (a UUID paste, a `type:` filter) that lane answering
  // nothing at all would be a dead end. It is taken through a thunk so the lane
  // never pays for a whole-corpus pass it discards whenever the leg DOES take
  // the query.
  const lexical = () => deps.lexicalFor(msg.q);
  const query = semanticLegQuery(msg.q, lane, deps.knowsChainlog);
  // A "did you mean" is only ever offered for a query that found nothing — and
  // only on a lane that is actually showing the wording index, since a spelling
  // correction says nothing about a meaning or entity search.
  const reply = (hits: SearchHit[], semantic: SemanticLegStatus, durationMs: number) =>
    deps.post({
      type: "results",
      id: msg.id,
      hits,
      durationMs,
      lane,
      semantic,
      ...(hits.length === 0 && lane === "lexical" && semantic !== "pending"
        ? { didYouMean: didYouMean(deps.index(), msg.q, deps.search) }
        : {}),
    });

  if (query === null) {
    const lex = lexical();
    reply(lex.hits, "none", lex.durationMs);
    return;
  }
  const run = {
    id: msg.id,
    query,
    lane,
    lexical: lane === "semantic" ? [] : lexical().hits,
    startedAt,
    debounceMs: semanticDebounceMs(msg.q, (word) => wordShapeIn(deps.index(), word)),
    hydrate: deps.hydrate,
    post: deps.post,
  };
  // Already scored this text? Then the answer is final now — no debounce, no
  // request, and no interim "pending" message, because nothing is pending.
  if (answerFromCache(run)) return;
  // On the semantic lane the lexical list is withheld: that lane is meant to
  // read as a DIFFERENT index, not as a re-ranking of the same one, so the main
  // thread stays in its searching state until the scored ids land.
  if (lane !== "semantic") reply(run.lexical, "pending", performance.now() - startedAt);
  runSemanticLeg(run);
}
