import { extractPhrases } from "@/lib/searchHighlight";
import { scopeOf, withoutScope } from "../lib/searchScope";

// Ticker pattern: all-caps tokens that the stemmer would mangle.
// NOTE: the phrase-filter substring check means "USDC" also matches "USDCe" in content.
const TICKER_RE = /^[a-z]{0,2}[A-Z]{2,}[0-9]*$/;

/** A query's syntax taken apart: `finalQuery` is what MiniSearch runs, the rest filter its results. */
export interface ParsedQuery {
  inPrefix: string | null;
  typeFilters: string[];
  phrases: string[];
  casePhrases: string[];
  fieldScopedTerms: Map<string, string[]>;
  fuzzyLevel: number | false;
  excludeTerms: string[];
  finalQuery: string;
}

export function parseQuery(q: string): ParsedQuery {
  // Extract the in:DOCNUMBER scope filter with the same rule the scope button
  // and the spelling correction read it by (lib/searchScope.ts).
  const inPrefix = scopeOf(q)?.toUpperCase() ?? null;
  const { typeFilters, rest: qForPhrases } = extractTypeFilters(withoutScope(q));
  const { phrases, casePhrases, rest: restAfterPhrases } = extractPhrases(qForPhrases);
  promoteTickers(restAfterPhrases, phrases, casePhrases);
  const { fieldScopedTerms, rest: restAfterFields } = extractFieldTerms(restAfterPhrases);
  const { fuzzyLevel, rest: restAfterFuzzy } = extractFuzzy(restAfterFields);
  const { excludeTerms, rest: finalQuery } = extractExclusions(restAfterFuzzy);
  return { inPrefix, typeFilters, phrases, casePhrases, fieldScopedTerms, fuzzyLevel, excludeTerms, finalQuery };
}

// Extract type:VALUE filters
function extractTypeFilters(q: string): { typeFilters: string[]; rest: string } {
  const TYPE_RE = /\btype:\s*(?:"([^"]+)"|([A-Za-z][A-Za-z0-9_-]*))/gi;
  const typeFilters: string[] = [];
  const rest = q
    .replace(TYPE_RE, (_, quoted: string | undefined, bare: string | undefined) => {
      const raw = (quoted ?? bare ?? "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (raw) typeFilters.push(raw);
      return " ";
    })
    .trim();
  return { typeFilters, rest };
}

// Tickers get auto-added as phrases so the stemmer can't mangle them.
// Skip exclusion tokens ("-word") — they're parsed separately below, and
// promoting one here would add the same ticker as both a required phrase
// and an excluded term, a self-contradictory filter that matches nothing.
function promoteTickers(rest: string, phrases: string[], casePhrases: string[]): void {
  const restWords = rest.trim().split(/\s+/).filter(Boolean);
  for (const word of restWords) {
    if (word.startsWith("-")) continue;
    const bare = word.replace(/^[+\-~]/, "").replace(/[~^*]\d*$/, "");
    if (
      bare.length >= 3 &&
      bare.length <= 8 &&
      TICKER_RE.test(bare) &&
      !phrases.includes(bare) &&
      !casePhrases.includes(bare)
    ) {
      phrases.push(bare);
    }
  }
}

// Extract field scope: title:foo, content:foo, doc_no:foo
// Terms are removed from the query — free terms search all fields, field-scoped
// terms are enforced via the filter callback so mixed queries like
// `title:Facilitator core` correctly restrict only "Facilitator" to the title.
function extractFieldTerms(q: string): { fieldScopedTerms: Map<string, string[]>; rest: string } {
  const fieldScopedTerms = new Map<string, string[]>();
  const rest = q
    .replace(/\b(title|content|doc_no):\s*(\S+)/gi, (_, field, term) => {
      const f = (field as string).toLowerCase();
      if (!fieldScopedTerms.has(f)) fieldScopedTerms.set(f, []);
      fieldScopedTerms.get(f)!.push(term as string);
      return " "; // removed from MiniSearch query; checked via filter instead
    })
    .trim();
  return { fieldScopedTerms, rest };
}

// Extract ~N fuzzy operator (applied globally to the query)
function extractFuzzy(q: string): { fuzzyLevel: number | false; rest: string } {
  let fuzzyLevel: number | false = false;
  const rest = q
    .replace(/(\S+)~(\d+)/g, (_, term, n) => {
      fuzzyLevel = parseInt(n as string, 10);
      return term as string;
    })
    .trim();
  return { fuzzyLevel, rest };
}

// Extract -word exclusions as a post-filter
function extractExclusions(q: string): { excludeTerms: string[]; rest: string } {
  const excludeTerms: string[] = [];
  const rest = q
    .replace(/(?:^|\s)-(\w+)/g, (_, term) => {
      excludeTerms.push((term as string).toLowerCase());
      return " ";
    })
    .trim();
  return { excludeTerms, rest };
}
