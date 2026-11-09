import type { AtlasNode, SearchHit } from "@/types";
import { buildSnippet, highlightTerms } from "@/lib/searchHighlight";
import { counterpartTerm, expandQueryTokens } from "@/lib/searchInflect";
import type { ParsedQuery } from "./searchQuery";

export type MiniResult = { id: unknown; score: number; terms: string[]; queryTerms: string[]; match: Record<string, string[]> };

/** A query that is a known chainlog id: its address and the docs that reference it. */
export interface ChainlogMatch {
  id: string;
  addr: string;
  hits: Map<string, SearchHit>;
}

/** The worker's hitFor: the SearchHit fields every lane derives the same way from a doc. */
export type RenderHit = (doc: AtlasNode, score: number, titleHtml: string, matchReason: string, snippet: string) => SearchHit;

export function toHits(results: MiniResult[], p: ParsedQuery, docs: Record<string, AtlasNode>, render: RenderHit): SearchHit[] {
  const terms = highlightTermsFor(p);
  return results
    .map((r): SearchHit | null => {
      const doc = docs[r.id as string];
      if (!doc) return null;
      return render(
        doc,
        r.score,
        highlightTerms(doc.title, terms.title, p.phrases, p.casePhrases),
        matchReasonFor(r.match, p),
        buildSnippet(doc.content, terms.content, p.phrases, p.casePhrases),
      );
    })
    .filter((h): h is SearchHit => h !== null);
}

function highlightTermsFor(p: ParsedQuery): { title: string[]; content: string[] } {
  // Use original query words for highlighting (not stems)
  // Exclude words that came from phrases — the phrase highlight covers them.
  // Without this, "Delegated" from 'Delegated Signers' leaks into terms and
  // highlights "delegatedSigners" case-insensitively via the \w* extension.
  const phraseWordSet = new Set(
    [...p.phrases, ...p.casePhrases].flatMap((ph) => ph.toLowerCase().split(/\s+/)),
  );
  const queryWords = p.finalQuery
    .trim()
    .split(/\s+/)
    .filter((w) => w && !phraseWordSet.has(w.toLowerCase()));

  // title: and content: scoped terms only highlight in their own field.
  // doc_no: and unscoped terms are treated as free (highlight everywhere).
  const fieldTitle = p.fieldScopedTerms.get("title") ?? [];
  const fieldContent = p.fieldScopedTerms.get("content") ?? [];
  const strictFieldTerms = new Set([...fieldTitle, ...fieldContent].map((w) => w.toLowerCase()));
  const freeWords = queryWords.filter((w) => !strictFieldTerms.has(w.toLowerCase()));
  const inflectedFree = expandQueryTokens(freeWords).extra;
  const counterparts = (terms: string[]) => terms.flatMap((t) => {
    const other = counterpartTerm(t);
    return other ? [other] : [];
  });
  return {
    title: [...fieldTitle, ...counterparts(fieldTitle), ...freeWords, ...inflectedFree],
    content: [...fieldContent, ...counterparts(fieldContent), ...freeWords, ...inflectedFree],
  };
}

// Build matchReason from MiniSearch match object: { term: [field, ...] }
function matchReasonFor(match: Record<string, string[]>, p: ParsedQuery): string {
  const fieldSet = new Set<string>();
  for (const fields of Object.values(match)) {
    for (const f of fields) fieldSet.add(f);
  }
  const scoped = p.fieldScopedTerms;
  const parts: string[] = [];
  if (p.typeFilters.length > 0) parts.push("type");
  if (fieldSet.has("title") || scoped.has("title")) parts.push("title");
  if (fieldSet.has("doc_no") || scoped.has("doc_no")) parts.push("doc number");
  if (fieldSet.has("content") || scoped.has("content")) parts.push("content");
  if (p.phrases.length > 0 || p.casePhrases.length > 0) parts.push("exact phrase");
  return parts.join(" + ");
}

// Merge with three tiers:
//   1. found by BOTH chainlog + search  (best snippet from search, highest priority)
//   2. chainlog only
//   3. search only  (sorted by score)
export function mergeChainlog(hits: SearchHit[], chainlog: ChainlogMatch): SearchHit[] {
  const hitsById = new Map(hits.map((h) => [h.id, h]));

  const both: SearchHit[] = [];
  const chainlogOnly: SearchHit[] = [];
  for (const [id, chainlogHit] of chainlog.hits) {
    const hit = hitsById.get(id);
    if (hit) {
      both.push({
        ...hit,
        matchReason: "chainlog + " + hit.matchReason,
        chainlogId: chainlog.id,
        chainlogAddress: chainlog.addr,
      });
    } else {
      chainlogOnly.push(chainlogHit);
    }
  }
  const searchOnly = hits.filter((h: SearchHit) => !chainlog.hits.has(h.id));

  both.sort((a, b) => b.score - a.score);
  searchOnly.sort((a, b) => b.score - a.score);

  return [...both, ...chainlogOnly, ...searchOnly];
}
