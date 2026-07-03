// Structural + cross-case context for the HTML-era curation LLM (plan §10.4 enrichment).
// Pure: reads the committed queue shape ({ nodes, cases }); no IO/LLM. Used by BOTH the batch
// auto-curator and the offline decision audit so the curator and its independent auditor judge
// on identical evidence. Answers two questions the raw candidate list can't:
//   1. WHERE does each document sit — its structural neighbors (the docs immediately before/
//      after it in its version). The ONLY way to tell near-identical stubs apart.
//   2. If this candidate is NOT the predecessor here, does any OTHER document still claim it, or
//      is it left with no successor (treated as DELETED)? A "sole home" is strong evidence.

const NEIGH = 3; // neighbors per side to surface (matches attachContext's radius)

// Neighbor titles for a node, nearest-first, resolved from the prev/next keys the queue stored.
// null when the node has no recorded position (nothing useful to show).
export function nodeContext(key, nodes) {
  const n = nodes[key];
  if (!n) return null;
  const titles = (keys) => (keys || []).slice(0, NEIGH).map((k) => nodes[k]?.title || "(untitled)");
  const prev = titles(n.prev), next = titles(n.next);
  // breadcrumb path (section › ancestors) — the disambiguator when title+content are identical
  const path = [n.section, ...(n.ancestors || [])].filter(Boolean);
  if (!prev.length && !next.length && !n.doc_no && !path.length && !n.scope && !n.parentTitle) return null;
  return {
    docNo: n.doc_no || null, prev, next,
    ...(path.length ? { path } : {}),
    ...(n.scope ? { scope: n.scope } : {}),
    ...(n.parentTitle ? { parent: n.parentTitle } : {}), // owning process/element for orphaned children
  };
}

// candidateKey -> Set of DISTINCT subject keys that list it as a candidate, across the whole
// queue. size 1 ⇒ "sole home" (only this subject can continue it).
export function buildClaimIndex(cases) {
  const idx = new Map();
  for (const c of cases || []) {
    for (const cand of c.candidates || []) {
      let s = idx.get(cand.key);
      if (!s) idx.set(cand.key, (s = new Set()));
      s.add(c.subjectKey);
    }
  }
  return idx;
}

// The subject side of a proposePredecessor call, with its structural position. null if the
// subject node isn't in the queue (can't judge — caller skips).
export function enrichSubject(subjectKey, nodes) {
  const n = nodes[subjectKey];
  if (!n) return null;
  return { title: n.title, content: n.content, context: nodeContext(subjectKey, nodes) };
}

// The candidate side: title + content + (diff evidence, if a hop case attached one) + structural
// position + the sole-home cross-case flag. Drops candidates whose node is missing.
export function enrichCandidates(kase, nodes, claimIndex) {
  return (kase.candidates || [])
    .map((cand) => {
      const n = nodes[cand.key];
      if (!n) return null;
      const claimers = claimIndex.get(cand.key);
      const others = claimers ? claimers.size - 1 : 0;
      return {
        key: cand.key, title: n.title, content: n.content,
        ...(cand.diff ? { diff: cand.diff } : {}),
        context: nodeContext(cand.key, nodes),
        soleHome: others <= 0, alsoClaimedBy: Math.max(0, others),
      };
    })
    .filter(Boolean);
}
