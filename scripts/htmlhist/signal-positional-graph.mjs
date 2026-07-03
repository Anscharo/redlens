// SIGNAL PROTOTYPE (read-only): positional + reference-graph disambiguation.
//
// The residual is dominated by NEAR-IDENTICAL SIBLINGS — e.g. "Operational GovOps
// Review" appears 171× (once under each agent), all with identical content, so content
// similarity is flat and useless. What DOES differ is a doc's position in the tree and
// its citation structure. This prototype measures three orthogonal positional signals,
// each on its own AND combined:
//
//   P1 ancestor/parent reconciliation — subject.parentTitle (markdown side) vs a
//      candidate's `ancestors` chain / `section` (HTML side). The one structural field
//      that survives the seam for template children.
//   P2 neighbor-title overlap — Jaccard of {prev∪next titles} between subject & candidate
//      (the 3 nearest doc-order neighbors, nearest-first, stored in the queue).
//   P3 outgoing-reference-title overlap — the set of "A.x.y - <Title>" citations in each
//      doc's content; a doc keeps citing the same siblings across a hop. Title survives
//      renumbering better than doc_no, so we key on the title tail.
//
// Measured with the shared harness against the 35 residual + the ~2865 resolved
// ambiguous cases (disagreement = a confident pick that contradicts the confirmed
// pairing = a red flag ON THE SIGNAL). Writes .cache/signal-positional-graph.json only.
//
//   node scripts/aux/signal-positional-graph.mjs

import { loadSignalData, pickByScore, crossValidate, measureResidual, writeOut } from "./residual-signal-lib.mjs";

const norm = (s) => (s || "").toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

// prev/next stored nearest-first as node KEYS; resolve to titles via ctx.node.
function neighborTitles(node, ctx) {
  const t = new Set();
  for (const k of node?.prev || []) { const n = ctx.node(k); if (n?.title) t.add(norm(n.title)); }
  for (const k of node?.next || []) { const n = ctx.node(k); if (n?.title) t.add(norm(n.title)); }
  return t;
}

// "A.x.y - Some Title" -> the trailing title tail ("some title"), which is stable across
// renumbering. Also captures the final segment of multi-part "A.1.8 - X - Y - Z" refs.
const REF_RE = /A\.\d+(?:\.\d+)*\s*-\s*([^.\n\]]{2,70})/g;
function refTitles(node) {
  const out = new Set();
  const c = node?.content || "";
  let m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(c))) {
    const parts = m[1].split(" - ");
    const tail = norm(parts[parts.length - 1]);
    if (tail.length >= 3) out.add(tail);
  }
  return out;
}

function jaccard(a, b) {
  if (!a.size && !b.size) return null; // undefined — no evidence
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

// P1: how well a candidate's structural ancestry matches the subject's parent. Returns a
// score in [0,1] or null when neither side carries the field.
function ancestorScore(subj, cand) {
  const parent = norm(subj?.parentTitle);
  const anc = (cand?.ancestors || []).map(norm);
  const section = norm(cand?.section);
  if (!parent || (!anc.length && !section)) return null;
  if (anc.includes(parent)) return 1; // exact ancestor hit
  if (section && section === parent) return 0.9;
  // partial: parent name is a token-substring of an ancestor (handles "Launch Agent 1
  // Development Company" vs "Launch Agent 1"). Non-symmetric containment either way.
  for (const a of anc) if (a.includes(parent) || parent.includes(a)) return 0.6;
  if (section && (section.includes(parent) || parent.includes(section))) return 0.5;
  return 0; // both sides present, no relation — evidence AGAINST
}

function main() {
  const ctx = loadSignalData();

  const scoreP1 = (subj, cand) => ancestorScore(subj, cand);
  const scoreP2 = (subj, cand) => (subj && cand ? jaccard(neighborTitles(subj, ctx), neighborTitles(cand, ctx)) : null);
  const scoreP3 = (subj, cand) => (subj && cand ? jaccard(refTitles(subj), refTitles(cand)) : null);
  // combined: P1 dominates (structural truth), P2/P3 break ties and supply evidence when
  // P1 is null. Weighted sum over available sub-scores.
  const scoreCombined = (subj, cand) => {
    const p1 = scoreP1(subj, cand);
    const p2 = scoreP2(subj, cand);
    const p3 = scoreP3(subj, cand);
    let num = 0, den = 0;
    if (p1 != null) { num += 3 * p1; den += 3; }
    if (p2 != null) { num += 1 * p2; den += 1; }
    if (p3 != null) { num += 1.5 * p3; den += 1.5; }
    return den ? num / den : null;
  };

  const variants = {
    "P1-ancestor": pickByScore(scoreP1, { margin: 0.3, minTop: 0.5 }),
    "P2-neighbors": pickByScore(scoreP2, { margin: 0.15, minTop: 0.3 }),
    "P3-references": pickByScore(scoreP3, { margin: 0.15, minTop: 0.3 }),
    combined: pickByScore(scoreCombined, { margin: 0.15, minTop: 0.4 }),
  };

  const results = {};
  for (const [name, pickFn] of Object.entries(variants)) {
    const residual = measureResidual(pickFn, ctx);
    const cv = crossValidate(pickFn, ctx, ctx.resolvedEvaluable);
    results[name] = { residual, crossValidation: cv };
    console.log(`\n[positional/${name}]`);
    console.log(`  RESIDUAL: disambiguated ${residual.decidedCount}/${residual.total}`);
    for (const dd of residual.decided) console.log(`    ${dd.caseKey.slice(0, 20)} -> "${dd.chosenTitle}"  (${dd.reason})`);
    console.log(`  CROSS-VAL: decided ${cv.decided}/${cv.evaluable}  agree=${cv.agree} disagree=${cv.disagree}  disagreeRate=${(cv.disagreeRate * 100).toFixed(1)}%  coverage=${(cv.coverage * 100).toFixed(1)}%`);
  }

  // diagnostic: for the identical-sibling residual cases, is P1 even capable (does the
  // subject carry parentTitle and do candidates carry ancestors)?
  const diag = [];
  for (const c of ctx.residualCases) {
    const subj = ctx.node(c.subjectKey);
    const cands = (c.candidates || []).map((x) => ctx.node(x.key)).filter(Boolean);
    const ancSet = new Set(cands.flatMap((n) => (n.ancestors || []).map(norm)));
    diag.push({
      caseKey: c.key,
      kind: c.kind,
      nCands: c.candidates.length,
      subjParent: subj?.parentTitle || null,
      subjHasNeighbors: !!(subj?.prev?.length || subj?.next?.length),
      distinctCandAncestors: ancSet.size,
      subjParentInSomeAncestor: subj?.parentTitle ? [...ancSet].some((a) => a.includes(norm(subj.parentTitle)) || norm(subj.parentTitle).includes(a)) : false,
    });
  }

  const rel = writeOut(".cache/signal-positional-graph.json", { signal: "positional-reference-graph", variants: results, residualDiagnostic: diag });
  console.log(`\n[positional] wrote ${rel}`);
}

main();
