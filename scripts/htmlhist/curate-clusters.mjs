// Cluster builder for the HTML-era curation MATRIX pass (joint LLM assignment). Pure: reads the
// committed queue shape ({ cases }) + the resolved-baseline decisions; no IO/LLM.
//
// The per-doc LLM pass judges each case in isolation, so it can't honour the constraint that a
// single OLDER row is the predecessor of AT MOST ONE newer row — two subjects that share a
// candidate can both pick it (the ⚠ conflict the UI only flags after the fact). This groups the
// residual cases into CLUSTERS (connected components of the subject↔candidate bipartite graph),
// so the whole cluster can be assigned jointly under that mutual-exclusion constraint.
//
// Scope: RESIDUAL cases only (the LLM workload), and each cluster's candidate pool has candidates
// already CLAIMED by a resolved sibling removed (they're off the table). Clusters never span a hop
// (an older row belongs to exactly one older→newer transition), verified empirically.

// Union-find over case keys.
function makeUF() {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  const union = (a, b) => { parent.set(find(a), find(b)); };
  return { find, union };
}

// Build residual clusters. `cases` is the full queue; `resolved` a Set of resolved case keys;
// `claimed` a Set of candidate keys a resolved decision already chose (removed from pools).
// Returns { clusters, stats }. A cluster is { caseKeys[], candidateKeys[], hop }.
export function buildClusters(cases, resolved, claimed, { maxSize = 12 } = {}) {
  const residual = (cases || []).filter((c) => !resolved.has(c.key));
  const byCase = new Map(residual.map((c) => [c.key, c]));
  const availCands = (c) => (c.candidates || []).map((x) => x.key).filter((k) => !claimed.has(k));

  const { find, union } = makeUF();
  const candToCases = new Map();
  for (const c of residual) {
    find(c.key); // register even the singletons
    for (const k of availCands(c)) {
      const a = candToCases.get(k) || [];
      a.push(c.key);
      candToCases.set(k, a);
    }
  }
  for (const [, ks] of candToCases) {
    const uniq = [...new Set(ks)];
    for (let i = 1; i < uniq.length; i++) union(uniq[0], uniq[i]);
  }

  const comp = new Map();
  for (const c of residual) {
    const r = find(c.key);
    if (!comp.has(r)) comp.set(r, []);
    comp.get(r).push(c.key);
  }

  const clusters = [];
  let oversized = 0, oversizedCases = 0;
  for (const caseKeys of comp.values()) {
    const cands = new Set();
    let hop = null;
    for (const k of caseKeys) {
      const c = byCase.get(k);
      hop = `${c.olderSha}>${c.newerSha}`;
      for (const cand of availCands(c)) cands.add(cand);
    }
    const cluster = { caseKeys: caseKeys.slice(), candidateKeys: [...cands], hop, size: caseKeys.length };
    if (caseKeys.length > maxSize) { oversized++; oversizedCases += caseKeys.length; cluster.oversized = true; }
    clusters.push(cluster);
  }
  // deterministic order: biggest first, then by first case key
  clusters.sort((a, b) => b.size - a.size || a.caseKeys[0].localeCompare(b.caseKeys[0]));

  const multi = clusters.filter((c) => c.size > 1);
  const stats = {
    residual: residual.length,
    clusters: clusters.length,
    singletons: clusters.filter((c) => c.size === 1).length,
    multiClusters: multi.length,
    casesInMulti: multi.reduce((s, c) => s + c.size, 0),
    oversized, oversizedCases, maxSize,
    largest: clusters[0]?.size || 0,
  };
  return { clusters, stats };
}
