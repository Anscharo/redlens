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

export function seedFromMd(mdNodes, htmlNodes, { minOverlap = 0.5 } = {}) {
  const inv = new Map(); // shingle -> [mdIndex]
  const mdSh = mdNodes.map((m) => new Set(shArr(m.content)));
  mdNodes.forEach((_, i) => { for (const s of mdSh[i]) { let a = inv.get(s); if (!a) inv.set(s, (a = [])); a.push(i); } });

  // best-overlap md doc per html row + which md bodies are contained in some row
  const rowBest = new Map();      // row -> { mi, cov }
  const containedMd = new Set();  // md docs whose body sits inside a row (split candidates)
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
      if (c / mdSh[mi].size >= 0.8) containedMd.add(mi);
    }
    if (bestMi >= 0 && best >= minOverlap) rowBest.set(row, { mi: bestMi, cov: best });
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

  const seam = new Map(); // plan §4.1
  mdNodes.forEach((m, i) => seam.set(m.uuid, primaryByMd.has(i) ? "kept" : containedMd.has(i) ? "split" : "created"));
  const splitCount = [...containedMd].filter((mi) => !primaryByMd.has(mi)).length;
  return {
    uuidByRow, mergedInto, seam,
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
  const byUuid = new Map();
  for (const c of commits) for (const n of c.nodes) {
    let arr = byUuid.get(n.uuid); if (!arr) byUuid.set(n.uuid, (arr = []));
    arr.push({ seq: c.seq, sha: c.sha, node: n });
  }
  const lastSeq = commits[commits.length - 1].seq;
  const events = [];
  // `era` is an ADDITIVE field for EntryRow (plan §9): downstream can show a
  // pre-markdown / converter-derived warning without altering existing fields.
  const push = (e) => events.push({ era, ...e });
  for (const [uuid, occAll] of byUuid) {
    // one occurrence per commit (defensive: a uuid should be unique per commit)
    const occ = occAll.sort((a, b) => a.seq - b.seq).filter((o, i, arr) => i === 0 || o.seq !== arr[i - 1].seq);
    for (let i = 0; i < occ.length; i++) {
      const newRun = i === 0 || occ[i].seq !== occ[i - 1].seq + 1;
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
    if (last.seq < lastSeq) push({ uuid, type: "removed", sha: last.sha, seq: last.seq }); // disappeared before the era's end
  }
  return events;
}
