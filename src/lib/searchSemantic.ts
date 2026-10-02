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

/**
 * Which index the results page is querying — the three pills on the count line.
 *
 * Meaning-matched results appear on the `semantic` lane and NOWHERE else. The
 * lane is the ONLY knob: the leg never blends into the wording lane, neither by
 * fusing both result sets (which reads worse than either list alone) nor by
 * answering a wording search that found nothing. A reader on the wording lane
 * asked for a wording search, and quietly answering with a different index —
 * one whose rows can share no word with the query — is a worse answer than an
 * honest empty one next to a pill that offers the other index. It also costs the
 * spelling correction, which is only offered for a wording search that found
 * nothing, and so cannot survive the leg replacing that result set.
 */
export const SEARCH_LANES = ["lexical", "graph", "semantic"] as const;
export type SearchLane = (typeof SEARCH_LANES)[number];

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
 * Pause after the last keystroke before the semantic round-trip. It matches
 * the /reports lane's 200ms even though this one costs an OpenRouter embedding
 * call: the embed round trip is the slow part of the search, so the pause is
 * kept short, and the per-minute budget (search-semantic-limit.ts) caps the
 * extra calls a shorter pause sends.
 */
export const SEMANTIC_DEBOUNCE_MS = 256;

/** Is `q` worth sending to the semantic backend at all? */
export function semanticWorthAsking(q: string): boolean {
  const t = q.trim();
  return t.length >= MIN_SEMANTIC_QUERY && t.length <= MAX_SEMANTIC_QUERY;
}

// Structured, lexical-only query syntax, in the three shapes the search worker
// parses out before MiniSearch sees them: a field filter (title:, type:,
// content:, doc_no:), an exclusion (-word), and the fuzzy operator (foo~2).
// Each captures the whole token, because the reader is told verbatim which ones
// the meaning lane dropped.
//
// `in:` is deliberately EXEMPT — it is a doc-number subtree filter, and unlike
// the others it IS honoured on the meaning lane (doc_no is a column on
// atlas_doc_meta, which the semantic query already joins). See semanticQueryOf.
// Case-INSENSITIVE, and that matters only for the `in:` exemption: the lexical
// leg parses the scope with a /gi regex, so `In:A.6` is a scope there, and
// without the flag here the same query would read as a filter to drop.
//
// A field filter's value may be quoted, so it is matched whole — that keeps the
// quotes inside `type:"Type Specification"` out of the quoting report below.
const FIELD_FILTER_RE = /\b(?!in:)\w+:(?:"[^"]*"|'[^']*'|\S+)/gi;
const EXCLUSION_RE = /(^|\s)(-\w+)/g;
const FUZZY_RE = /\S+~\d+/g;

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
 * Split `q` into the text this lane can embed, the `in:` scope it honours, and
 * the lexical-only syntax it cannot.
 *
 * ONE function, because the strip and the reader-facing note must never
 * disagree about what was dropped: `semanticQueryOf` sends `bare`, and
 * `semanticLaneLimit` reports `ignored`.
 *
 * `in:` comes out first because it is a filter and not something to embed —
 * left in the text, the model would score documents against the literal string
 * "in:A.6.1". Everything else in `ignored` is simply removed: this lane scores
 * whole documents, so there is no string for a field filter, an exclusion, a
 * fuzzy operator or a quoted phrase to act on. The reader is told, rather than
 * being answered as though their filter had applied.
 *
 * The truncation is BEFORE the length check, not after: a pasted paragraph is
 * exactly the query meaning-matching can help with, and refusing it over its
 * length would be the one case where the lane stands down for no reason.
 */
function planSemantic(q: string): { bare: string; scope?: string; ignored: string[] } {
  let scope: string | undefined;
  const withoutScope = q.replace(IN_SCOPE_RE, (_, p: string) => {
    scope = p.toUpperCase();
    return " ";
  });
  const ignored: string[] = [];
  const rest = withoutScope
    .replace(FIELD_FILTER_RE, (m) => { ignored.push(m); return " "; })
    .replace(EXCLUSION_RE, (_m, lead: string, word: string) => { ignored.push(word); return lead; })
    .replace(FUZZY_RE, (m) => { ignored.push(m); return " "; });
  // Quoting is reported separately from the operators because its consequence
  // differs: the words survive the strip, only the promise of a literal match
  // does not. Each mark is named once, as the reader typed it.
  for (const mark of ['"', "'"]) if (rest.includes(mark)) ignored.push(`${mark}…${mark}`);
  const bare = rest
    .replace(/["']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEMANTIC_QUERY)
    .trim();
  return scope ? { bare, scope, ignored } : { bare, ignored };
}

/**
 * The request to send for `q`, or null when there is nothing left to score.
 *
 * Quoted phrases DO pass, with the quote characters dropped: a phrase search
 * that found nothing literally is exactly where meaning-matching earns its
 * keep, and every such hit is labelled as a semantic match, so nothing claims
 * to contain a phrase it does not.
 */
export function semanticQueryOf(q: string): SemanticQuery | null {
  const p = planSemantic(q);
  if (!semanticWorthAsking(p.bare)) return null;
  return p.scope ? { query: p.bare, scope: p.scope } : { query: p.bare };
}

/**
 * What the meaning lane could not honour for `q`, or null when it answers the
 * query exactly as typed. Drives the note above the results.
 *
 * `too-short` WINS over `ignored`, because the two describe different legs: with
 * nothing embeddable left the lane stands down and the lexical leg answers, and
 * that leg does honour the syntax — calling it ignored would be false. `syntax`
 * rides along in both so the note can name what emptied the query.
 */
export type SemanticLaneLimit =
  | { kind: "ignored"; syntax: string[] }
  | { kind: "too-short"; syntax: string[] };

export function semanticLaneLimit(q: string): SemanticLaneLimit | null {
  const p = planSemantic(q);
  if (!semanticWorthAsking(p.bare)) return { kind: "too-short", syntax: p.ignored };
  return p.ignored.length > 0 ? { kind: "ignored", syntax: p.ignored } : null;
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
