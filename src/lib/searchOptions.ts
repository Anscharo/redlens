import type MiniSearch from "minisearch";

// Canonical MiniSearch construction options, shared by the search worker (which
// loadJSON's the prebuilt index) and the Bun server (which deserializes the same
// search-index.json). MiniSearch.loadJSON requires options identical to the ones
// the index was built with, so these MUST match the producer in
// scripts/required/build-index.mjs (that file keeps its own copy — it runs under
// node and can't import this .ts; mirror any change there).
// `_` is part of a word: `erc4626_redeem` is ONE token, searched the same way
// as `delegatedSigners`. The default tokenizer treats `_` as punctuation, which
// split identifiers into parts that match unrelated documents.
const SPLIT_RE = /(?:[\n\r\p{Z}]|(?!_)\p{P})+/u;
const tokenize = (text: string): string[] => text.split(SPLIT_RE);

// Strip leading/trailing non-word chars so backtick-wrapped tokens like
// `delegatedSigners` index as "delegatedsigners" not "`delegatedsigners`".
const normalize = (term: string): string => term.replace(/^[^a-zA-Z0-9_]+|[^a-zA-Z0-9_]+$/g, "").toLowerCase();

// Indexing also emits the `_`-separated parts, so `vat` still finds `MCD_VAT`.
const processTerm = (term: string): string | string[] | null => {
  const whole = normalize(term);
  if (whole.length < 2) return null;
  if (!whole.includes("_")) return whole;
  const parts = whole.split("_").filter((p) => p.length >= 2);
  return [whole, ...parts];
};

// Queries keep only the whole token: `erc4626_redeem` must not widen to every
// document that mentions `redeem`.
export const MINISEARCH_SEARCH_OPTIONS = {
  tokenize,
  processTerm: (term: string): string | null => {
    const whole = normalize(term);
    return whole.length >= 2 ? whole : null;
  },
};

export const MINISEARCH_OPTIONS: ConstructorParameters<typeof MiniSearch>[0] = {
  fields: ["title", "doc_no", "type", "content"],
  // No storeFields — the index intentionally stores nothing per result to keep
  // the artifact small. Consumers that need doc fields (type, etc.) resolve them
  // from the docs map by id (see search.worker.ts docFilter + search.ts runLexical).
  idField: "id",
  tokenize,
  processTerm,
};
