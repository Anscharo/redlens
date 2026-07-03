// Positional / reference-graph disambiguation — a FOURTH independent corroborator for
// HTML-era auto-curation (plan §10.4), discovered by the residual-signal sweep
// (.cache/residual-signal-candidates.md, 2026-07-03).
//
// WHY this and not more content overlap. The three existing signals — the reverse shingle
// matcher, the forward mutual-best tracer, and ordered-containment — are all CONTENT
// comparisons. Their shared blind spot is NEAR-IDENTICAL SIBLINGS: e.g. "Operational
// GovOps Review" appears 171× (once per agent) with byte-identical content, so every
// content signal is flat and can't tell the copies apart. What DOES differ is a doc's
// POSITION in the tree and its CITATION structure. This module scores three orthogonal
// positional signals, none of which reads the doc's own body text:
//   P1 ancestor/parent reconciliation — subject.parentTitle (md side) vs a candidate's
//      `ancestors` chain / `section` (html side): the structural field that survives the
//      #117 seam for template children.
//   P2 neighbor-title overlap — Jaccard of the {prev ∪ next} neighbor titles the curation
//      queue stores per node (the 3 nearest doc-order siblings, nearest-first).
//   P3 outgoing-reference-title overlap — the set of "A.x.y - <Title>" citations in the
//      body; a doc keeps citing the same siblings across a hop. Keyed on the title tail,
//      which survives renumbering better than the doc_no.
// Measured on the ~2865 already-resolved ambiguous cases the combined pick has ~0
// genuinely-wrong-document disagreements once corroborated by an independent content
// signal — the lock rule the orchestrator enforces (positional ∩ matcher/forward/
// containment), mirroring pass 1 / 1.5.

const norm = (s) => (s || "").toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

// prev/next are stored as node KEYS (nearest-first); resolve to a set of neighbor titles.
function neighborTitles(node, nodes) {
  const t = new Set();
  for (const k of node?.prev || []) { const n = nodes[k]; if (n?.title) t.add(norm(n.title)); }
  for (const k of node?.next || []) { const n = nodes[k]; if (n?.title) t.add(norm(n.title)); }
  return t;
}

// "A.x.y - Some Title" (optionally multi-segment "A.1.8 - X - Y - Z") -> the trailing title
// tail, which is stable across renumbering. Stops at sentence/bracket punctuation.
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

// Jaccard of two sets; null when BOTH are empty (no evidence either way).
function jaccard(a, b) {
  if (!a.size && !b.size) return null;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

// P1: how well a candidate's structural ancestry matches the subject's parent. [0,1] or
// null when neither side carries the field. Both-present-but-unrelated returns 0 (evidence
// AGAINST), which lets a wrong-parent sibling be actively demoted.
export function ancestorScore(subj, cand) {
  const parent = norm(subj?.parentTitle);
  const anc = (cand?.ancestors || []).map(norm);
  const section = norm(cand?.section);
  if (!parent || (!anc.length && !section)) return null;
  if (anc.includes(parent)) return 1;
  if (section && section === parent) return 0.9;
  for (const a of anc) if (a.includes(parent) || parent.includes(a)) return 0.6; // "Launch Agent 1 Development Company" ⊃ "Launch Agent 1"
  if (section && (section.includes(parent) || parent.includes(section))) return 0.5;
  return 0;
}

// The three sub-scores for a (subject, candidate) pair. Each is a number or null.
export function positionalScores(subj, cand, nodes) {
  return {
    p1: ancestorScore(subj, cand),
    p2: subj && cand ? jaccard(neighborTitles(subj, nodes), neighborTitles(cand, nodes)) : null,
    p3: subj && cand ? jaccard(refTitles(subj), refTitles(cand)) : null,
  };
}

// Weighted fusion over the available sub-scores (P1 dominates — structural truth; P3 next;
// P2 supplies evidence when P1 is null, which is the identical-sibling common case). Null
// when nothing scored.
export function combinedScore(subj, cand, nodes) {
  const { p1, p2, p3 } = positionalScores(subj, cand, nodes);
  let num = 0, den = 0;
  if (p1 != null) { num += 3 * p1; den += 3; }
  if (p2 != null) { num += 1 * p2; den += 1; }
  if (p3 != null) { num += 1.5 * p3; den += 1.5; }
  return den ? num / den : null;
}

// Calibrated gates (from the residual-signal sweep). LOCK-grade margin: the combined top
// must beat the runner-up by ≥ MARGIN and clear MIN_TOP, else abstain (a disambiguator
// must not guess among ties).
export const POS_MARGIN = 0.15;
export const POS_MIN_TOP = 0.4;

// The positional pick for a case: argmax combined score over `candidateKeys`, margin-gated.
// Returns { chosenKey, top, margin, p1, p2 } or null (abstain / nothing scorable). `p1`/`p2`
// are the winner's ancestor + neighbor sub-scores, so a caller can require SELF-corroboration
// (P1 and P2 both point the same way) for the uncorroborated HINT path.
export function positionalPick(subjectNode, candidateKeys, nodes, { margin = POS_MARGIN, minTop = POS_MIN_TOP } = {}) {
  const scored = [];
  for (const key of candidateKeys) {
    const s = combinedScore(subjectNode, nodes[key], nodes);
    if (s != null && Number.isFinite(s)) scored.push({ key, s, p1: ancestorScore(subjectNode, nodes[key]) });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.s - a.s);
  const top = scored[0];
  const runner = scored[1];
  if (top.s < minTop) return null;
  const marg = runner ? top.s - runner.s : top.s;
  if (runner && marg < margin) return null;
  const p2 = subjectNode ? jaccard(neighborTitles(subjectNode, nodes), neighborTitles(nodes[top.key], nodes)) : null;
  return { chosenKey: top.key, top: top.s, margin: marg, p1: top.p1, p2 };
}

// Does the positional pick SELF-corroborate — do P1 (ancestor) and P2 (neighbor) each
// independently favour the same candidate the fusion chose? Used to gate the advisory HINT
// path for matcher-null cases that have no external content corroborator: two independent
// positional sub-signals agreeing is the substitute for the missing content signal.
export function positionalSelfCorroborates(pick) {
  return !!pick && pick.p1 != null && pick.p1 >= 0.9 && pick.p2 != null && pick.p2 >= 0.5;
}
