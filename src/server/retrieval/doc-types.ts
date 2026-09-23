// The atlas's own document-type vocabulary, derived from the atlas — never a
// hardcoded list (upstream regroups the corpus and adds types; a literal list
// would be one edit away from rejecting a valid type).
//
// Two vocabularies exist and they are NOT the same, which is the whole reason
// this module exists:
//   · DECLARED — the children of "List Of Document Types And Their
//     Specifications", one Type Specification per type, titled "The <Name>
//     Type". 30 of them.
//   · IN USE — the `type` values documents actually carry, which is what a
//     `target_type` filter matches. 12 of them.
// They differ in wording as well as in size: the atlas declares "The Element
// Annotation Type" while its documents carry `Annotation`, and declares
// "The Facilitator Scenario Type" for documents typed `Scenario`. A model
// quoting the atlas's own name therefore filtered to nothing (measured
// 2026-09-23). A declared name that ends with an in-use type resolves to it;
// the rest are real types with no documents yet (Budget Document, Translation,
// Archive …), which is worth saying out loud rather than calling a typo.
import type { Indexes, AtlasNode } from "./indexes.ts";

// The type-list Core. UUID is the stable identity (CLAUDE.md); the doc_no is
// a comment because renumbering moves it.
const TYPE_LIST_UUID = "428b7f2e-30b0-4119-a10a-9c3496f19bd2"; // A.1.2.2.2

/** "The Element Annotation Type" → "Element Annotation". */
export function declaredTypeName(title: string): string {
  return title.replace(/^The\s+/i, "").replace(/\s+Type$/i, "").trim();
}

export interface DocTypeVocabulary {
  /** Types documents actually carry — the only values a filter can match. */
  inUse: string[];
  /** Every type the atlas declares, in atlas order. */
  declared: string[];
  /** Declared (or loosely written) name, lowercased → the in-use type it means. */
  resolve: Map<string, string>;
  /** Declared types no document carries yet. */
  declaredUnused: string[];
}

const cache = new WeakMap<Indexes, DocTypeVocabulary>();

export function docTypeVocabulary(ix: Indexes): DocTypeVocabulary {
  const hit = cache.get(ix);
  if (hit) return hit;

  const inUse = [...new Set([...ix.docMap.values()].map((d) => d.type))].filter(Boolean).sort();
  const kids: AtlasNode[] = ix.childrenIndex.get(TYPE_LIST_UUID) ?? [];
  const declared = kids.map((k) => declaredTypeName(k.title)).filter(Boolean);

  const resolve = new Map<string, string>();
  for (const t of inUse) resolve.set(t.toLowerCase(), t);
  const declaredUnused: string[] = [];
  for (const d of declared) {
    const lower = d.toLowerCase();
    if (resolve.has(lower)) continue;
    // "Facilitator Action Tenet" → "Action Tenet", "Element Annotation" →
    // "Annotation": the declared name carries a qualifier the type value drops.
    // Longest in-use match wins so "Active Data Controller" never collapses to
    // "Active Data".
    const match = inUse
      .filter((u) => lower.endsWith(u.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0];
    if (match) resolve.set(lower, match);
    else declaredUnused.push(d);
  }

  const vocab = { inUse, declared, resolve, declaredUnused };
  cache.set(ix, vocab);
  return vocab;
}

export interface TargetTypeResolution {
  /** The value to filter on, or null when nothing can match it. */
  type: string | null;
  /** Set when the caller's wording was rewritten, for the response echo. */
  resolvedFrom?: string;
  /** Set when nothing can match — the sentence to hand back. */
  problem?: string;
}

/** Resolves a caller's `target_type` to a value documents carry. */
export function resolveTargetType(ix: Indexes, raw: string): TargetTypeResolution {
  const vocab = docTypeVocabulary(ix);
  const tries = [raw, declaredTypeName(raw)];
  for (const t of tries) {
    const hit = vocab.resolve.get(t.trim().toLowerCase());
    if (hit) return hit === raw ? { type: hit } : { type: hit, resolvedFrom: raw };
  }
  const declaredButEmpty = vocab.declaredUnused.find(
    (d) => d.toLowerCase() === declaredTypeName(raw).trim().toLowerCase(),
  );
  return {
    type: null,
    problem: declaredButEmpty
      ? `target_type='${raw}' is a type the atlas declares but no document currently carries`
      : `target_type='${raw}' is not a document type (documents carry: ${vocab.inUse.join(", ")})`,
  };
}
