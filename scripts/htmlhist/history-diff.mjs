// Changed-lines threading for the HTML era (2026-07). The pre-#117 pipeline matched
// documents across commits by whole-body similarity; this threads by the ACTUAL change
// instead — the same signal the markdown-era history uses. It reuses the shared diff
// core (src/lib/diffCore.ts): one implementation, byte-identical to build-history.
//
// Mechanism: at each hop, run the LCS (diffCore.lcsOps) over the two commits' per-node
// content HASHES, scoped per section (docs never cross the 11 invariant <h1>s). The `=`
// ops are UNCHANGED anchors — positionally pinned, which resolves the near-identical
// "directory stub" ambiguity that content-similarity cannot. An adjacent `-`run / `+`run
// between two anchors is that segment's changed-set:
//   1 older ↔ 1 newer  → a deterministic EDIT (position proves identity), gated by a
//                        light similarity check so an unrelated delete+add isn't fused.
//   N older, 0 newer   → deaths      0 older, M newer → births
//   N:M (N,M ≥ 1)      → ambiguous — deferred to the fuzzy matcher / §10.4 LLM, but now
//                        SCOPED to that tiny changed-set with the diff as evidence.
//
// Pure: no git, no IO. Callers pass the node arrays they already loaded; matchNodes and
// the curation queue consume the returned edits/evidence.

import { lcsOps, lineDiff, capDiff } from "../../src/lib/diffCore.ts";

// group a commit's nodes by section, preserving document order within each
function bySection(nodes) {
  const m = new Map();
  for (const n of nodes) {
    let g = m.get(n.section);
    if (!g) m.set(n.section, (g = []));
    g.push(n);
  }
  return m;
}

// Confidence that (older → newer) is the SAME document edited, not an unrelated
// delete+add that merely sits alone between two anchors. Same structural key ⇒ certain;
// otherwise the fraction of content lines the two share (LCS equal-run over lines).
export function editConfidence(older, newer) {
  if (older.structuralKey && older.structuralKey === newer.structuralKey) return 1;
  const a = (older.content || "").split("\n");
  const b = (newer.content || "").split("\n");
  if (!a.length || !b.length) return 0;
  const eq = lcsOps(a, b).reduce((acc, [op]) => acc + (op === "=" ? 1 : 0), 0);
  return eq / Math.max(a.length, b.length);
}

// Diff two commits' node arrays into a threading signal. `minConfidence` gates the
// deterministic 1:1 edit (below it, the pair degrades to a death+birth — conservative,
// "flag never guess"). Returns object refs from the INPUT arrays so callers can map back.
export function diffThread(older, newer, { minConfidence = 0.5 } = {}) {
  const oSecs = bySection(older);
  const nSecs = bySection(newer);
  const edits = [], births = [], deaths = [], ambiguous = [];

  for (const sec of new Set([...oSecs.keys(), ...nSecs.keys()])) {
    const os = oSecs.get(sec) || [];
    const ns = nSecs.get(sec) || [];
    const ops = lcsOps(os.map((x) => x.contentHash), ns.map((x) => x.contentHash));

    let oi = 0, ni = 0, runO = [], runN = [];
    const flush = () => {
      if (!runO.length && !runN.length) return;
      if (runO.length === 1 && runN.length === 1) {
        const confidence = editConfidence(runO[0], runN[0]);
        if (confidence >= minConfidence) edits.push({ older: runO[0], newer: runN[0], confidence: +confidence.toFixed(3) });
        else { deaths.push(runO[0]); births.push(runN[0]); }
      } else if (runO.length && !runN.length) deaths.push(...runO);
      else if (!runO.length && runN.length) births.push(...runN);
      else ambiguous.push({ section: sec, olders: runO.slice(), newers: runN.slice() });
      runO = []; runN = [];
    };
    for (const [op] of ops) {
      if (op === "=") { flush(); oi++; ni++; }
      else if (op === "-") runO.push(os[oi++]);
      else runN.push(ns[ni++]); // "+"
    }
    flush();
  }
  return { edits, births, deaths, ambiguous };
}

// Convenience: just the confident edits as a Map<olderNode, newerNode> for matchNodes.
export function diffEditsMap(older, newer, opts = {}) {
  const m = new Map();
  for (const e of diffThread(older, newer, opts).edits) m.set(e.older, e.newer);
  return m;
}

// Compact "deleted vs added" block for LLM evidence — the changed lines only (context is
// available from the full bodies also shown). Reuses diffCore.lineDiff semantics.
export function diffText(older, newer, { max = 40 } = {}) {
  const a = (older?.content || "").split("\n");
  const b = (newer?.content || "").split("\n");
  const out = [];
  for (const [op, val] of lcsOps(a, b)) {
    if (op === "=") continue;
    out.push((op === "-" ? "- " : "+ ") + val);
    if (out.length >= max) { out.push("…"); break; }
  }
  return out.join("\n");
}

// Structured evidence (DiffLine[] with ±context, capped) if a caller wants to render it
// like the rest of the history UI rather than the plain text block above.
export function diffLines(older, newer, { max = 24 } = {}) {
  return capDiff(lineDiff(older?.content || "", newer?.content || ""), max);
}
