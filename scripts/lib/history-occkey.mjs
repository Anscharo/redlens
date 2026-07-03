// Occurrence-precise content-address keys for HTML-era nodes.
//
// A document's identity binds to (commit, content) via `${sha}:${contentHash}`. But
// near-identical "directory stub" rows share the same content WITHIN a commit, so the plain
// key cannot say WHICH one a decision picked — and identical-content rows in different
// structural positions thread into DIFFERENT lineages (syntheticUuid keys on section +
// ancestors). When a content-address is duplicated in its commit, disambiguate by the node's
// document order; unique content keeps the plain key (surgical — only genuine stubs change).
//
// EVERY site that mints or resolves a PREDECESSOR (older-side) key must use this so the keys
// line up: the curation candidates + autoKey (build-history-curation), the forward pass's
// predecessor opinion (history-forward-trace), and the apply index (prepare-html-history).
// Subject-side (newer) keys stay plain — they are the caseKey / rawUuid join and are not the
// thing a decision disambiguates.

export function contentDupCounts(nodes) {
  const counts = new Map();
  for (const n of nodes) counts.set(n.contentHash, (counts.get(n.contentHash) || 0) + 1);
  return counts;
}

export function occKey(sha, node, dupCounts) {
  const base = `${sha}:${node.contentHash}`;
  return (dupCounts.get(node.contentHash) || 1) > 1 ? `${base}#${node.order}` : base;
}
