// SIGNAL PROTOTYPE (read-only): sibling-count reconciliation.
//
// Question: per scope/section, does the total document count balance before vs after a hop?
// An imbalance flags a likely split / merge / birth / death that content similarity alone
// cannot resolve. This is framed as a DETECTOR ("does a 1:1 predecessor even exist / is this
// a split-merge zone?") first, and only secondarily probed as a candidate picker.
//
// Method:
//   1. For every hop (olderSha -> newerSha that appears among cases), count nodes per scope
//      and per section (parentTitle) on each side, straight from data.nodes (each node
//      carries sha + scope + parentTitle). delta = newerCount - olderCount.
//        delta > 0  => the section GAINED docs  (split / birth)
//        delta < 0  => the section LOST docs     (merge / death)
//        delta = 0  => balanced (a clean 1:1 predecessor is plausible)
//   2. Detector on the 35 residual cases: classify the subject's own section balance across
//      its hop (birth-zone / merge-zone / balanced). A birth-zone subject is a candidate for
//      "no true predecessor" (abstain is the right call); a balanced/merge zone says a
//      predecessor should exist.
//   3. Picker probe: prefer the candidate whose section (parentTitle) — then scope — matches
//      the subject's, as the consistent structural origin. margin-gated. Expected to be weak:
//      residual candidates are usually siblings in the SAME section (that is WHY they are
//      ambiguous), so section rarely separates them. We measure and say so.
//
// Writes .cache/signal-sibling-count.json only.
//   node scripts/aux/signal-sibling-count.mjs

import { loadSignalData, pickByScore, crossValidate, measureResidual, writeOut } from "./residual-signal-lib.mjs";

// group nodes by sha -> scope|section -> count
function tallies(nodes) {
  const byShaScope = new Map();
  const byShaSection = new Map();
  const bump = (m, sha, key) => {
    let inner = m.get(sha);
    if (!inner) m.set(sha, (inner = new Map()));
    inner.set(key, (inner.get(key) || 0) + 1);
  };
  for (const k in nodes) {
    const n = nodes[k];
    bump(byShaScope, n.sha, n.scope || "(none)");
    bump(byShaSection, n.sha, `${n.scope || "(none)"} / ${n.parentTitle || "(root)"}`);
  }
  return { byShaScope, byShaSection };
}

function hopDeltas(olderSha, newerSha, byShaX) {
  const os = byShaX.get(olderSha) || new Map();
  const ns = byShaX.get(newerSha) || new Map();
  const keys = new Set([...os.keys(), ...ns.keys()]);
  const rows = [];
  for (const key of keys) {
    const o = os.get(key) || 0;
    const n = ns.get(key) || 0;
    if (o !== n) rows.push({ key, older: o, newer: n, delta: n - o });
  }
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return rows;
}

function main() {
  const ctx = loadSignalData();
  const { node, nodes, data } = ctx;
  const { byShaScope, byShaSection } = tallies(nodes);

  // ---- 1. Per-hop section/scope balance tables (descriptive) ----
  const hops = new Set();
  for (const c of data.cases || []) hops.add(`${c.olderSha}|${c.newerSha}`);
  const hopReports = [];
  for (const h of hops) {
    const [olderSha, newerSha] = h.split("|");
    hopReports.push({
      olderSha,
      newerSha,
      scopeDeltas: hopDeltas(olderSha, newerSha, byShaScope),
      sectionDeltas: hopDeltas(olderSha, newerSha, byShaSection).slice(0, 12),
    });
  }

  // per-hop section-delta lookup for the detector
  const sectionDeltaKey = (sha) => byShaSection.get(sha) || new Map();
  function sectionBalance(c) {
    const subj = node(c.subjectKey);
    if (!subj) return null;
    const key = `${subj.scope || "(none)"} / ${subj.parentTitle || "(root)"}`;
    const older = sectionDeltaKey(c.olderSha).get(key) || 0;
    const newer = sectionDeltaKey(c.newerSha).get(key) || 0;
    const delta = newer - older;
    const zone = delta > 0 ? "birth/split" : delta < 0 ? "merge/death" : "balanced";
    return { section: key, older, newer, delta, zone };
  }

  // ---- 2. Detector over the 35 residual cases ----
  const residualDetector = ctx.residualCases.map((c) => ({
    caseKey: c.key,
    kind: c.kind,
    nCandidates: (c.candidates || []).length,
    balance: sectionBalance(c),
  }));
  const zoneCounts = residualDetector.reduce((a, r) => {
    const z = r.balance?.zone || "(unknown)";
    a[z] = (a[z] || 0) + 1;
    return a;
  }, {});

  // ---- 3. Picker probe: section-origin match, then scope ----
  const scoreFn = (subj, cn) => {
    if (!subj || !cn) return null;
    let s = 0;
    if ((cn.parentTitle || null) === (subj.parentTitle || null)) s += 2;
    if ((cn.scope || null) === (subj.scope || null)) s += 1;
    return s;
  };
  const pickFn = pickByScore(scoreFn, { margin: 1, minTop: 1 });

  const residual = measureResidual(pickFn, ctx);
  const cv = crossValidate(pickFn, ctx, ctx.resolvedEvaluable);

  // structural fact: how often could section/scope even separate residual candidates?
  let scopeSep = 0;
  let sectionSep = 0;
  for (const c of ctx.residualCases) {
    const s = node(c.subjectKey);
    const scopes = new Set(c.candidates.map((x) => node(x.key)?.scope));
    const secs = new Set(c.candidates.map((x) => node(x.key)?.parentTitle));
    if (!(scopes.size === 1 && scopes.has(s?.scope))) scopeSep++;
    if (!(secs.size === 1 && secs.has(s?.parentTitle))) sectionSep++;
  }

  const out = {
    signal: "sibling-count-reconciliation",
    hopCount: hops.size,
    hopReports,
    residualDetector,
    residualZoneCounts: zoneCounts,
    residualCandidatesScopeSeparable: `${scopeSep}/${ctx.residualCases.length}`,
    residualCandidatesSectionSeparable: `${sectionSep}/${ctx.residualCases.length}`,
    residual,
    crossValidation: cv,
  };
  const rel = writeOut(".cache/signal-sibling-count.json", out);

  console.log(`[sibling-count] hops=${hops.size}`);
  console.log(`[sibling-count] example scope imbalances (a few hops):`);
  for (const hr of hopReports.slice(0, 4)) {
    const parts = hr.scopeDeltas.slice(0, 5).map((d) => `${d.key}:${d.older}->${d.newer}(${d.delta > 0 ? "+" : ""}${d.delta})`);
    console.log(`    ${hr.olderSha}->${hr.newerSha}  ${parts.join("  ")}`);
  }
  console.log(`[sibling-count] residual section-balance zones: ${JSON.stringify(zoneCounts)}`);
  console.log(`[sibling-count] residual candidates scope-separable=${scopeSep}/${ctx.residualCases.length}  section-separable=${sectionSep}/${ctx.residualCases.length}`);
  console.log(`[sibling-count] RESIDUAL (picker probe): disambiguated ${residual.decidedCount}/${residual.total}`);
  for (const dd of residual.decided) console.log(`    ${dd.caseKey.slice(0, 24)} -> "${dd.chosenTitle}"  (${dd.reason})`);
  console.log(`[sibling-count] CROSS-VAL: decided ${cv.decided}/${cv.evaluable}  agree=${cv.agree} disagree=${cv.disagree}  disagreeRate=${(cv.disagreeRate * 100).toFixed(1)}%`);
  console.log(`[sibling-count] wrote ${rel}`);
}

main();
