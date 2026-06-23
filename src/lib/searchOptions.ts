import type MiniSearch from "minisearch";

// Canonical MiniSearch construction options, shared by the search worker (which
// loadJSON's the prebuilt index) and the Bun server (which deserializes the same
// search-index.json). MiniSearch.loadJSON requires options identical to the ones
// the index was built with, so these MUST match the producer in
// scripts/required/build-index.mjs (that file keeps its own copy — it runs under
// node and can't import this .ts; mirror any change there).
export const MINISEARCH_OPTIONS: ConstructorParameters<typeof MiniSearch>[0] = {
  fields: ["title", "doc_no", "type", "content"],
  idField: "id",
  processTerm: (term) => {
    // Strip leading/trailing non-alphanumeric chars so backtick-wrapped tokens
    // like `delegatedSigners` index as "delegatedsigners" not "`delegatedsigners`".
    const lower = term.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "").toLowerCase();
    return lower.length >= 2 ? lower : null;
  },
};
