// Query-time singular/plural expansion for MiniSearch (reader worker +
// runLexical) and the relations.json entity overlay. Not a stemmer: we never
// write both forms into the index (that would flatten ranking). Callers OR the
// counterpart into the query, then partitionByOriginalTerms so original-term
// hits always sit above inflection-only hits.
import pluralize from "pluralize";
import { UUID_PREFIX_RE, UUID_RE } from "./patterns";

// Atlas proper names / tickers that are not English count nouns.
for (const w of ["sky", "usds", "susds", "dai", "mkr"]) pluralize.addUncountableRule(w);

// Same shapes the search worker already treats as non-prose (tickers, chainlog
// ids, doc numbers). Kept here so runLexical can skip them without importing
// the worker.
const TICKER_RE = /^[a-z]{0,2}[A-Z]{2,}[0-9]*$/;
const CHAINLOG_RE = /^[A-Z][A-Z0-9_]{2,}$/;
const DOC_NO_RE = /^[A-Z][A-Z0-9]*(?:\.\w+)+$|^NR-\d+$/i;

/** Strip MiniSearch operators the worker leaves on a free token. */
function bareToken(raw: string): string {
  return raw.replace(/^[+\-~]/, "").replace(/[~^*]\d*$/, "");
}

/** Same normalisation MiniSearch processTerm applies (lowercase, edge punct). */
export function normalizeToken(raw: string): string | null {
  const lower = bareToken(raw).replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "").toLowerCase();
  return lower.length >= 2 ? lower : null;
}

function shouldSkipRaw(raw: string): boolean {
  if (raw.length < 3) return true;
  if (/\d/.test(raw)) return true;
  if (TICKER_RE.test(raw) || CHAINLOG_RE.test(raw) || DOC_NO_RE.test(raw)) return true;
  if (UUID_RE.test(raw) || UUID_PREFIX_RE.test(raw)) return true;
  // ALL-CAPS prose is a ticker/acronym, not a noun to inflect.
  if (/[A-Z]/.test(raw) && raw === raw.toUpperCase()) return true;
  return false;
}

/**
 * Singular/plural counterpart to add as an extra MiniSearch query term, or
 * null when prefix search already covers the pair (or the token is not a
 * complete English noun). Asymmetric: `agent` → null (`agents` is a prefix
 * hit); `agents` → `agent`; `subsidy` ↔ `subsidies`.
 */
export function counterpartTerm(raw: string): string | null {
  const stripped = bareToken(raw);
  if (shouldSkipRaw(stripped)) return null;
  const lower = stripped.toLowerCase();
  if (lower.length < 3) return null;

  const singular = pluralize.singular(lower);
  const plural = pluralize.plural(lower);
  if (pluralize.singular(plural) !== singular) return null;

  const other = singular === lower ? plural : singular;
  if (other === lower) return null;
  // Uncountable lemma (sky/sky) — not a real number pair.
  if (pluralize.singular(other) === pluralize.plural(other)) return null;
  // Prefix-gate: adding a longer form double-counts under prefix:true.
  // Shorter form (plural → singular) is the case prefix cannot see.
  if (other.startsWith(lower)) return null;
  return other;
}

export interface QueryExpansion {
  originals: string[];
  extra: string[];
  all: string[];
}

/** Expand whitespace-split query tokens. `all` is originals then extras. */
export function expandQueryTokens(rawTokens: string[]): QueryExpansion {
  const originals: string[] = [];
  const originalSet = new Set<string>();
  const extra: string[] = [];
  const extraSet = new Set<string>();
  for (const raw of rawTokens) {
    if (!raw) continue;
    const norm = normalizeToken(raw);
    if (norm && !originalSet.has(norm)) {
      originalSet.add(norm);
      originals.push(norm);
    }
    const other = counterpartTerm(raw);
    if (other && !originalSet.has(other) && !extraSet.has(other)) {
      extraSet.add(other);
      extra.push(other);
    }
  }
  return { originals, extra, all: extra.length > 0 ? [...originals, ...extra] : originals };
}

/** Original-term hits (exact or prefix) first; inflection-only hits after. */
export function partitionByOriginalTerms<T extends { queryTerms: string[] }>(
  hits: T[],
  originalTerms: ReadonlySet<string>,
): T[] {
  if (originalTerms.size === 0) return hits;
  const original: T[] = [];
  const inflected: T[] = [];
  for (const h of hits) {
    if (h.queryTerms.some((t) => originalTerms.has(t))) original.push(h);
    else inflected.push(h);
  }
  return [...original, ...inflected];
}
