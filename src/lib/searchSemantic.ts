// Shared contract for the reader's semantic search lane.
//
// The atlas already has a semantic backend — pgvector over `atlas_doc_embeddings`,
// built for chat retrieval (src/server/retrieval/search.ts `runSemantic`). This
// module is the narrow, isomorphic piece that lets the SEARCH BAR use it too:
// the wire shape of GET /api/search/semantic, the two knobs that decide when the
// lane runs, and the pure rank fusion both sides agree on.
//
// Deliberately dependency-free (no node:, no DOM, no React): it is imported by
// the Bun server, the search web worker, and React components alike.

/** Which index the results page is querying. Variant 3's three-way toggle. */
export const SEARCH_LANES = ["lexical", "graph", "semantic"] as const;
export type SearchLane = (typeof SEARCH_LANES)[number];

/**
 * What the semantic leg does on the DEFAULT (wording) lane:
 *   off      — never call it; wording only.
 *   fallback — call it only when wording returned nothing. Free in the common
 *              case, since a query that already matched costs no embed.
 * The explicit `semantic` lane ignores this — picking that lane IS the request.
 *
 * There used to be a third, `woven`, which always called the leg and fused both
 * result sets by RRF. Dropped 2026-09-29: interleaving meaning-matched rows
 * into a wording result set made the list harder to read, not better, and it
 * bought one embedding call on every settled search to do it. The consequence
 * is that the leg now only ever REPLACES a result set, never merges into one —
 * see `postFused`.
 */
export const SEMANTIC_STRATEGIES = ["off", "fallback"] as const;
export type SemanticStrategy = (typeof SEMANTIC_STRATEGIES)[number];

export function isSemanticStrategy(v: unknown): v is SemanticStrategy {
  return typeof v === "string" && (SEMANTIC_STRATEGIES as readonly string[]).includes(v);
}

export function isSearchLane(v: unknown): v is SearchLane {
  return typeof v === "string" && (SEARCH_LANES as readonly string[]).includes(v);
}

/** One scored document id. The client owns docs.json, so no text crosses the wire. */
export interface SemanticSearchHit {
  id: string;
  /** Cosine similarity, 0..1 (already above config.semanticMinScore). */
  score: number;
  /**
   * Set when the hit was retrieved through a grouped embedding anchor and
   * attributed down to this leaf — the title of the group it was found under.
   * Surfaced in the UI because "why is this a match?" is otherwise invisible
   * for a hit that shares no word with the query.
   */
  viaTitle?: string;
}

export interface SemanticSearchResponse {
  hits: SemanticSearchHit[];
  /**
   * Non-null when the leg was wanted but degraded at RUNTIME (embed timeout,
   * provider error, pgvector error). An unconfigured deployment is not
   * degradation — it reports `available: false` instead.
   */
  skipped: string | null;
  /** False when this deployment has no embedding key: the lane can never work. */
  available: boolean;
}

/** What to ask the semantic backend, once the query's filters are split out. */
export interface SemanticQuery {
  /** The text to embed — filters removed, quotes dropped. */
  query: string;
  /** An `in:` doc-number subtree the results must fall inside, upper-cased. */
  scope?: string;
}

/** Longest query we will embed. Matches the reports-search lane's ceiling. */
export const MAX_SEMANTIC_QUERY = 200;

/**
 * Shortest query worth an embed. A one- or two-character prefix carries no
 * meaning to score against, and the lexical lane's prefix match already owns
 * that case — this is what stops "a", "ac", "acc" each buying a round-trip.
 */
export const MIN_SEMANTIC_QUERY = 3;

/**
 * Pause after the last keystroke before the semantic round-trip. Longer than
 * the /reports lane's 200ms because this one costs an OpenRouter embedding
 * call, not a local wasm run.
 */
export const SEMANTIC_DEBOUNCE_MS = 400;

/**
 * The pause instead when the query's last word is still HALF TYPED — a strict
 * prefix of a word the corpus has, like "collater" on the way to "collateral".
 *
 * Embedding a truncated word is the one request guaranteed to be wasted: the
 * vector is scored against whole documents, so a fragment no document contains
 * lands somewhere arbitrary in the space and the reader pays a round-trip to be
 * shown it. Waiting is strictly better than guessing.
 *
 * It is a longer WAIT and not a refusal on purpose. Nothing here can tell a
 * half-typed word from a deliberate one (a reader searching for a word the
 * atlas spells differently types something the index never completes), so a
 * hard gate would leave those queries with no meaning search at all, and the
 * semantic lane hanging on a spinner that resolves only if they type more.
 * Over a second of stillness mid-word means the reader has stopped, and a
 * reader who has stopped gets an answer.
 */
export const SEMANTIC_PARTIAL_DEBOUNCE_MS = 1200;

// A trailing token that cannot be a word in progress: an operator, a field
// filter, a doc number, a bare figure. Stripped or rejected before the index is
// asked about it.
const TRAILING_FIELD_RE = /^\w+:/;
const TRAILING_WORDISH_RE = /^[A-Za-z][\w-]*$/;

/**
 * The word the reader may still be typing, or null when the query looks
 * settled.
 *
 * Whitespace or punctuation at the end means the word was committed — you do
 * not type a space or a comma into the middle of a word. Anything that is not
 * plain word characters starting with a letter is not a word in progress
 * either: `in:A.6`, `type:Core`, `-fees`, `A.2.7` and `2026` are all either
 * filters the lane strips out or identifiers it stands down on.
 */
export function trailingWord(q: string): string | null {
  if (q !== q.replace(/\s+$/, "")) return null;
  const last = q.split(/\s+/).pop() ?? "";
  const bare = last.replace(TRAILING_FIELD_RE, "").replace(/^[-+]/, "").replace(/~\d*$/, "");
  if (!TRAILING_WORDISH_RE.test(bare)) return null;
  return bare;
}

/** Is `q` worth sending to the semantic backend at all? */
export function semanticWorthAsking(q: string): boolean {
  const t = q.trim();
  return t.length >= MIN_SEMANTIC_QUERY && t.length <= MAX_SEMANTIC_QUERY;
}

// Structured, lexical-only query syntax: a field filter (title:, type:,
// content:, doc_no:), an exclusion (-word), or the fuzzy operator (foo~2).
// Matches what the search worker parses out before it reaches MiniSearch.
//
// `in:` is deliberately EXEMPT — it is a doc-number subtree filter, and unlike
// the others it can be enforced on the semantic side too (doc_no is a column on
// atlas_doc_meta, which the semantic query already joins). See semanticQueryOf.
const LEXICAL_SYNTAX_RE = /\b(?!in:)\w+:\S|(?:^|\s)-\w|\S~\d/;

/** The `in:A.6.1` subtree filter, as the search worker parses it. */
const IN_SCOPE_RE = /\bin:(\S+)/gi;

/**
 * Is `docNo` inside the `in:` subtree `scope`? The document itself counts, and
 * so does anything under it — the same rule the lexical leg applies, stated
 * once so the two legs cannot disagree about what `in:A.2` includes.
 *
 * Compares on the dotted SEGMENT, never the raw string: `A.2` must not swallow
 * `A.22`, which a bare startsWith would.
 */
export function inScope(docNo: string, scope: string): boolean {
  const d = docNo.toUpperCase();
  const s = scope.toUpperCase();
  return d === s || d.startsWith(`${s}.`);
}

/**
 * Could an EMBEDDING ANCHOR at `docNo` hold a member inside `scope`?
 *
 * Grouped anchors are ancestors of their members (embed-units.ts `emit` walks
 * the subtree under the anchor), so an anchor ABOVE the scope can carry leaves
 * inside it — `in:A.6.1.1.1.3.7` is served by an anchor at `A.6.1.1.1.3`. A
 * retrieval filter that kept only in-scope anchors would drop exactly those.
 * So the SQL side is deliberately permissive in this one direction, and the
 * exact `inScope` test is applied after attribution, where the LEAF is known.
 */
export function anchorCouldServeScope(docNo: string, scope: string): boolean {
  return inScope(docNo, scope) || inScope(scope, docNo);
}

/**
 * The text to embed for `q`, or null when the semantic lane should stand down.
 *
 * It stands down on structured syntax, and that is a correctness rule rather
 * than a nicety: `type:`, `in:` and `-word` are enforced by the LEXICAL leg
 * against the document map, so a semantic hit would come back unfiltered and a
 * search for `type:Core rewards` would be answered partly with documents that
 * are not Core. Rather than reimplement those filters over the semantic result
 * set, a query precise enough to use them is left to the lane that honours it.
 *
 * Quoted phrases DO pass, with the quote characters dropped: a phrase search
 * that found nothing literally is exactly where meaning-matching earns its
 * keep, and every such hit is labelled as a semantic match, so nothing claims
 * to contain a phrase it does not.
 */
export function semanticQueryOf(q: string): SemanticQuery | null {
  if (LEXICAL_SYNTAX_RE.test(q)) return null;
  // Pull `in:` out before anything else: it is a filter, not something to
  // embed. Leaving it in the text would have the model scoring documents
  // against the literal string "in:A.6.1".
  let scope: string | undefined;
  const withoutScope = q.replace(IN_SCOPE_RE, (_, p: string) => {
    scope = p.toUpperCase();
    return " ";
  });
  // Truncate BEFORE the length check, not after: a pasted paragraph is exactly
  // the query meaning-matching can help with, and refusing it over its length
  // would be the one case where the lane stands down for no reason.
  const bare = withoutScope
    .replace(/["']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEMANTIC_QUERY)
    .trim();
  if (!semanticWorthAsking(bare)) return null;
  return scope ? { query: bare, scope } : { query: bare };
}

// Reciprocal Rank Fusion constant. 60 is the value the chat retrieval path
// already fuses with (src/server/retrieval/search.ts) — kept identical so the
// reader and the agent rank a hybrid result set the same way.
export const RRF_K = 60;

/**
 * Reciprocal Rank Fusion over any number of ranked id lists.
 *
 * Pure and shared: the server's `rrfMerge` delegates here, so chat's hybrid
 * retrieval has one fusion and not a second copy of it. Ties keep
 * the order of first appearance, which makes the fusion stable for a lexical
 * list that is re-fused as the semantic leg lands.
 */
export function rrfFuse(lists: readonly (readonly string[])[]): Map<string, number> {
  const acc = new Map<string, number>();
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank];
      acc.set(id, (acc.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
    }
  }
  return acc;
}
