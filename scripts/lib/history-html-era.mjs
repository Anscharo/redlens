// HTML-era history passes (plan §4). Pure + testable; composes the §3 converter
// nodes and the §4.2 matcher into a backward identity thread (Pass A) and a
// forward event/diff emission (Pass B). No git/IO here — the orchestrator
// (freeze-html-history.mjs) loads commits via atlas-html and injects lineDiff.
//
// A "commit" is { sha, seq, nodes } where nodes are §3 atlas-html nodes.

import { matchNodes, syntheticUuid, isSynthetic } from "./history-identity.mjs";

// ---- seed: assign #117 md uuids onto the last HTML commit's rows -------------
// The one hard, cross-format hop (plan §4.0). Inverted shingle index → each HTML
// row gets the uuid of its best-overlap md doc. Returns a Map<htmlNode, uuid> plus
// seam bookkeeping. Cross-format, so this is containment/overlap — NOT exact hash.
const SH = 8;
// The seed is the one CROSS-FORMAT hop (md prose vs html→md markdown): normalize
// both sides to bare prose tokens so shingles are comparable across the boundary.
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const shArr = (content) => { const w = norm(content).split(" ").filter(Boolean), o = []; for (let i = 0; i + SH <= w.length; i++) o.push(w.slice(i, i + SH).join(" ")); return o; };
const titleTokens = (title) => new Set(norm(title).split(" ").filter(Boolean));
// Jaccard similarity of two token SETS: |intersection| / |union|, where
// |union| = |A| + |B| − |intersection|. 0 = no shared words, 1 = identical token sets.
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
};
// Structural tiebreak window (plan §4.2): when several md docs cover a row within
// TITLE_TIE_WINDOW coverage, content shingles alone can't separate near-identical
// siblings that differ only by chain/instance (boilerplate prose: "Base USDC Deposit
// Maximum" vs "Unichain USDC Deposit Maximum"). Prefer the candidate whose TITLE
// matches the row's title; override the content pick only past TITLE_TIE_MARGIN so an
// already-exact content match is never regressed. Titles barely change across the hop.
const TITLE_TIE_WINDOW = 0.1, TITLE_TIE_MARGIN = 0.34;

export function seedFromMd(mdNodes, htmlNodes, { minOverlap = 0.5 } = {}) {
  const mdTitleTokens = mdNodes.map((m) => titleTokens(m.title));
  const inv = new Map(); // shingle -> [mdIndex]
  const mdSh = mdNodes.map((m) => new Set(shArr(m.content)));
  mdNodes.forEach((_, i) => { for (const s of mdSh[i]) { let a = inv.get(s); if (!a) inv.set(s, (a = [])); a.push(i); } });

  // best-overlap md doc per html row + which md bodies are contained in some row
  const rowBest = new Map();      // row -> { mi, cov }
  const containedMd = new Set();  // md docs whose body sits inside a row (split candidates)
  const rowContains = new Map();  // row -> Set(mi) it contains (for extracted_from)
  for (const row of htmlNodes) {
    const rSh = shArr(row.content);
    if (!rSh.length) continue;
    const tally = new Map();
    for (const s of rSh) { const list = inv.get(s); if (list) for (const mi of list) tally.set(mi, (tally.get(mi) || 0) + 1); }
    if (!tally.size) continue;
    let bestMi = -1, best = 0;
    for (const [mi, c] of tally) {
      const cov = c / Math.min(rSh.length, mdSh[mi].size);
      if (cov > best) { best = cov; bestMi = mi; }
      if (c / mdSh[mi].size >= 0.8) { containedMd.add(mi); let rc = rowContains.get(row); if (!rc) rowContains.set(row, (rc = new Set())); rc.add(mi); }
    }
    if (bestMi >= 0 && best >= minOverlap) {
      // title tiebreak among content-tied candidates (see TITLE_TIE_WINDOW/MARGIN above)
      const rowTitleTokens = mdTitleTokens.length && titleTokens(row.title);
      if (rowTitleTokens && rowTitleTokens.size) {
        const baseTitleScore = jaccard(rowTitleTokens, mdTitleTokens[bestMi]);
        let altMi = bestMi, altTitleScore = baseTitleScore;
        for (const [mi, count] of tally) {
          if (best - count / Math.min(rSh.length, mdSh[mi].size) > TITLE_TIE_WINDOW) continue;
          const titleScore = jaccard(rowTitleTokens, mdTitleTokens[mi]);
          if (titleScore > altTitleScore + 1e-9) { altTitleScore = titleScore; altMi = mi; }
        }
        if (altMi !== bestMi && altTitleScore - baseTitleScore >= TITLE_TIE_MARGIN) bestMi = altMi;
      }
      const chosenCov = tally.get(bestMi) / Math.min(rSh.length, mdSh[bestMi].size);
      rowBest.set(row, { mi: bestMi, cov: chosenCov });
    }
  }

  // INVARIANT: one real uuid → exactly one (primary) row. Each md doc's uuid goes
  // to its single best-covering row; the other rows that matched it are `merged`
  // (recorded with merged_into; they get synthetic ids downstream). This keeps a
  // uuid unique per commit so the event model (Pass B) stays sane.
  const primaryByMd = new Map(); // mi -> { row, cov }
  for (const [row, { mi, cov }] of rowBest) { const p = primaryByMd.get(mi); if (!p || cov > p.cov) primaryByMd.set(mi, { row, cov }); }
  const uuidByRow = new Map();
  for (const [mi, { row }] of primaryByMd) uuidByRow.set(row, mdNodes[mi].uuid);
  const mergedInto = new Map();  // row -> successor (md) uuid it was absorbed into
  for (const [row, { mi }] of rowBest) if (!uuidByRow.has(row)) mergedInto.set(row, mdNodes[mi].uuid);

  // extracted_from: a split md child → the md uuid of the (kept) parent row whose
  // content cell contained it (plan §4.2 tier 4 / §4.1).
  const extractedFrom = new Map(); // split md uuid -> parent md uuid
  for (const mi of containedMd) {
    if (primaryByMd.has(mi)) continue; // kept, not a split child
    const childUuid = mdNodes[mi].uuid;
    for (const [row, set] of rowContains) {
      const parentUuid = uuidByRow.get(row);
      // guard self-reference from the one duplicated #117 uuid (7682 vs 7681, §2.2)
      if (parentUuid && parentUuid !== childUuid && set.has(mi)) { extractedFrom.set(childUuid, parentUuid); break; }
    }
  }

  const seam = new Map(); // plan §4.1
  mdNodes.forEach((m, i) => seam.set(m.uuid, primaryByMd.has(i) ? "kept" : containedMd.has(i) ? "split" : "created"));
  const splitCount = [...containedMd].filter((mi) => !primaryByMd.has(mi)).length;
  return {
    uuidByRow, mergedInto, extractedFrom, seam,
    stats: { rows: htmlNodes.length, seeded: uuidByRow.size, merged: mergedInto.size, kept: primaryByMd.size, split: splitCount, created: mdNodes.length - new Set([...primaryByMd.keys(), ...containedMd]).size },
  };
}

// ---- Pass A: backward identity threading ------------------------------------
// commits oldest→newest, each { sha, seq, nodes }. Mutates node.uuid. Mid-era
// deaths + unresolved-ambiguous rows get deterministic synthetic v5 uuids.
export function threadBackward(commits, { seed = new Map() } = {}) {
  const order = commits.slice().reverse(); // newest→oldest
  for (const n of order[0].nodes) n.uuid = seed.get(n) || syntheticUuid(n, order[0].sha);

  const decisions = [], synthetics = [], orphansByCommit = [];
  let curr = order[0].nodes;
  for (let i = 1; i < order.length; i++) {
    const older = order[i].nodes;
    const r = matchNodes(older, curr);
    for (const p of r.pairs) p.older.uuid = p.newer.uuid; // carry real/synthetic id back
    for (const a of r.ambiguous) {
      decisions.push({ sha: order[i].sha, reason: a.reason, score: a.score, order: a.older?.order });
      if (a.older && !a.older.uuid) a.older.uuid = syntheticUuid(a.older, order[i].sha); // surfaced for §10.4
    }
    for (const o of r.olderUnmatched) {
      o.uuid = syntheticUuid(o, order[i].sha); // died at the newer commit (going forward)
      synthetics.push({ uuid: o.uuid, sha: order[i].sha, kind: "death" });
    }
    // §10.2 orphan set: deaths here + births (newer rows with no older origin)
    orphansByCommit.push({ sha: order[i].sha, deaths: r.olderUnmatched.length, births: r.newerUnmatched.length });
    curr = older;
  }
  return { decisions, synthetics, orphansByCommit };
}

// ---- Pass B: forward event/diff emission ------------------------------------
// commits oldest→newest with node.uuid assigned. Mirrors build-history's event
// model so HTML-era rows render identically in EntryRow (plan §4.4). Handles
// disappear→reappear gaps as removed+added (slot-reuse safety).
export function buildEvents(commits, { lineDiff, era = "html" } = {}) {
  // `commits` is oldest→newest and CONTIGUOUS; run-adjacency is decided by the
  // position in THIS list (idx), NOT the absolute commit_seq — HTML commits are
  // not consecutive in the full submodule log (non-HTML commits interleave), so
  // seq+1 arithmetic would see a gap at every hop. seq is kept only for reference.
  const byUuid = new Map();
  commits.forEach((c, idx) => { for (const n of c.nodes) {
    let arr = byUuid.get(n.uuid); if (!arr) byUuid.set(n.uuid, (arr = []));
    arr.push({ idx, seq: c.seq, sha: c.sha, node: n });
  } });
  const lastIdx = commits.length - 1;
  const events = [];
  // `era` is an ADDITIVE field for EntryRow (plan §9): downstream can show a
  // pre-markdown / converter-derived warning without altering existing fields.
  const push = (e) => events.push({ era, ...e });
  for (const [uuid, occAll] of byUuid) {
    // one occurrence per commit (defensive: a uuid should be unique per commit)
    const occ = occAll.sort((a, b) => a.idx - b.idx).filter((o, i, arr) => i === 0 || o.idx !== arr[i - 1].idx);
    for (let i = 0; i < occ.length; i++) {
      const newRun = i === 0 || occ[i].idx !== occ[i - 1].idx + 1; // gap in the html-commit run
      if (newRun) {
        if (i > 0) push({ uuid, type: "removed", sha: occ[i - 1].sha, seq: occ[i - 1].seq });
        push({ uuid, type: "added", sha: occ[i].sha, seq: occ[i].seq, doc_no: occ[i].node.doc_no, title: occ[i].node.title, synthetic: isSynthetic(uuid) });
        continue;
      }
      const p = occ[i - 1].node, c = occ[i].node;
      if (p.contentHash !== c.contentHash) {
        const ev = { uuid, type: "modified", sha: occ[i].sha, seq: occ[i].seq };
        if (lineDiff) ev.diff = lineDiff(p.content, c.content);
        push(ev);
      }
      const pathChanged = p.doc_no !== c.doc_no || (p.ancestors || []).join(">") !== (c.ancestors || []).join(">") || p.title !== c.title;
      if (pathChanged) push({ uuid, type: "moved", sha: occ[i].sha, seq: occ[i].seq, movedFrom: p.doc_no, movedTo: c.doc_no, moveKind: "doc_no" });
    }
    const last = occ[occ.length - 1];
    if (last.idx < lastIdx) push({ uuid, type: "removed", sha: last.sha, seq: last.seq }); // disappeared before the era's end
  }
  return events;
}
