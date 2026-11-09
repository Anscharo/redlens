import type { AtlasNode } from "@/types";
import { counterpartTerm } from "@/lib/searchInflect";
import type { ParsedQuery } from "./searchQuery";

export type DocFilter = (result: { id: unknown }) => boolean;

// Single filter function passed to MiniSearch (and applied to the queryEmpty path).
// Handles: type:, in:, field:term, phrase, case-phrase, and -exclusion.
export function docFilterFor(p: ParsedQuery, docs: Record<string, AtlasNode>): DocFilter | undefined {
  // Pre-compile once per search (not once per document). Phrase / case-phrase
  // matching is a literal substring test — no \b anchors — per the documented
  // "quoted phrase = literal substring" contract; a \b-anchored regex can never
  // match a phrase that begins or ends with punctuation (e.g. "(USDS)"), since
  // \b never holds between two non-word characters. See searchHighlight.ts for
  // the (boundary-aware, for readable highlighting) highlight-side counterpart.
  const lowerPhrases = p.phrases.map((ph) => ph.toLowerCase());
  const fieldTermRes = fieldTermRegexes(p.fieldScopedTerms);
  const hasFilters =
    p.typeFilters.length > 0 ||
    p.inPrefix !== null ||
    fieldTermRes.size > 0 ||
    lowerPhrases.length > 0 ||
    p.casePhrases.length > 0 ||
    p.excludeTerms.length > 0;
  if (!hasFilters) return undefined;

  return (result) => {
    const doc = docs[result.id as string];
    return doc ? docPasses(doc, p, lowerPhrases, fieldTermRes) : false;
  };
}

function docPasses(doc: AtlasNode, p: ParsedQuery, lowerPhrases: string[], fieldTermRes: Map<string, RegExp[]>): boolean {
  const { typeFilters, inPrefix, casePhrases, excludeTerms } = p;
  if (typeFilters.length > 0 && !typeFilters.includes(doc.type.toLowerCase())) return false;
  if (inPrefix && doc.doc_no !== inPrefix && !doc.doc_no.startsWith(inPrefix + ".")) return false;
  for (const [field, res] of fieldTermRes) {
    const text = field === "title" ? doc.title : field === "content" ? doc.content : doc.doc_no;
    if (res.some((re) => !re.test(text))) return false;
  }
  if (lowerPhrases.length > 0) {
    const contentLower = doc.content.toLowerCase();
    const titleLower = doc.title.toLowerCase();
    if (lowerPhrases.some((ph) => !contentLower.includes(ph) && !titleLower.includes(ph))) return false;
  }
  if (casePhrases.some((ph) => !doc.content.includes(ph) && !doc.title.includes(ph))) return false;
  if (excludeTerms.length > 0) {
    const haystack = (doc.title + " " + doc.content).toLowerCase();
    if (excludeTerms.some((t) => haystack.includes(t))) return false;
  }
  return true;
}

// field:term regexes — case-insensitive; doc_no uses simple includes.
// Broad `title:subsidy` also accepts the singular/plural counterpart.
function fieldTermRegexes(fieldScopedTerms: Map<string, string[]>): Map<string, RegExp[]> {
  return new Map<string, RegExp[]>(
    [...fieldScopedTerms.entries()].map(([f, terms]) => [
      f,
      terms.map((t) => {
        const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const other = counterpartTerm(t);
        const body = other ? `(?:${esc(t)}|${esc(other)})` : esc(t);
        return new RegExp("\\b" + body + "\\b", "i");
      }),
    ]),
  );
}
