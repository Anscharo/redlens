// Independent FORWARD identity tracer + forward/reverse cross-check (the plan's
// §10.4 "back-and-forward check", generalised across the whole HTML era). Pure +
// testable; no git/IO (the orchestrator scripts/htmlhist/forward-trace-html-history.mjs
// loads commits and writes the report).
//
// WHY a *different* matcher. The production thread is BACKWARD (plan §4.0): it seeds
// real #117 uuids at the newest commit and carries them back. A naive forward pass
// using the same matchNodes() would be a TAUTOLOGY — matchNodes pairs are symmetric
// per hop, so the two passes partition identically and never disagree. To get a
// meaningful corroboration the forward tracer must decide independently. It does:
//   • tiers 1–2 (exact content hash, unique structural key) are unambiguous and
//     symmetric — kept identical, so both passes must agree there.
//   • the fuzzy residual uses MUTUAL-BEST shingle matching (direction-agnostic),
//     NOT the reverse matcher's greedy older-centric tier-2.7/3. This is the
//     independent half: where greedy-with-contention and global-mutual-best differ
//     is exactly the gray zone curation exists to resolve.
// It also knows NOTHING of the reverse stitching — no seed, no #117 uuids — and
// assigns its own quasi-ids (Q1, Q2, …) at the first commit, carried forward.

import { matchNodes, _internal } from "./history-identity.mjs";
import { contentDupCounts, occKey } from "./history-occkey.mjs";

const { shingleSet, jaccard, isShort } = _internal;
const FLOOR = 0.6; // confident mutual-best bar (matches the reverse matcher's fuzzyHi)

const byField = (rows, field) => {
  const m = new Map();
  for (const r of rows) { const k = r[field]; let g = m.get(k); if (!g) m.set(k, (g = [])); g.push(r); }
  return m;
};
const byOrder = (a, b) => a.order - b.order;
const brief = (n) => ({ title: n.title || "", doc_no: n.doc_no || null, type: n.type || "" });

// One hop, independently: which OLDER node is each NEWER node's predecessor?
// Returns { pairs:[{older,newer,method}], olderUnmatched, newerUnmatched }.
export function forwardMatch(older, newer, { floor = FLOOR } = {}) {
  const pairs = [];
  const oUsed = new Set(), nUsed = new Set();
  const cache = new Map();
  const take = (o, n, method) => { oUsed.add(o); nUsed.add(n); pairs.push({ older: o, newer: n, method }); };
  const freeO = () => older.filter((o) => !oUsed.has(o));
  const freeN = () => newer.filter((n) => !nUsed.has(n));

  // tier 1: exact content hash, positional within an identical-hash bucket (symmetric)
  {
    const oH = byField(older, "contentHash"), nH = byField(newer, "contentHash");
    for (const [h, oG] of oH) {
      const nG = nH.get(h);
      if (!nG) continue;
      const os = oG.slice().sort(byOrder), ns = nG.slice().sort(byOrder);
      const k = Math.min(os.length, ns.length);
      for (let i = 0; i < k; i++) take(os[i], ns[i], "exact");
    }
  }
  // tier 2: unique structural key on both sides (symmetric — a modified row whose key holds)
  {
    const oK = byField(freeO(), "structuralKey"), nK = byField(freeN(), "structuralKey");
    for (const [key, oG] of oK) {
      const nG = nK.get(key);
      if (!key || !nG) continue;
      const of = oG.filter((o) => !oUsed.has(o)), nf = nG.filter((n) => !nUsed.has(n));
      if (of.length === 1 && nf.length === 1) take(of[0], nf[0], "key");
    }
  }
  // residual: MUTUAL-BEST shingle within section (the independent decision). Pair
  // (o,n) iff o's best free newer is n AND n's best free older is o, score ≥ floor.
  const fo = freeO().filter((o) => !isShort(o)), fn = freeN().filter((n) => !isShort(n));
  const fnBySec = byField(fn, "section"), foBySec = byField(fo, "section");
  const best = (node, pool) => {
    const sh = shingleSet(node, cache);
    let b = null, bs = 0;
    for (const other of pool) { const s = jaccard(sh, shingleSet(other, cache)); if (s > bs) { bs = s; b = other; } }
    return b && bs >= floor ? { node: b, score: bs } : null;
  };
  const bestNewer = new Map(); // older -> {node,score}
  for (const o of fo) { const r = best(o, fnBySec.get(o.section) || []); if (r) bestNewer.set(o, r); }
  const bestOlder = new Map(); // newer -> {node,score}
  for (const n of fn) { const r = best(n, foBySec.get(n.section) || []); if (r) bestOlder.set(n, r); }
  for (const [o, { node: n }] of bestNewer) {
    const bo = bestOlder.get(n);
    if (bo && bo.node === o && !oUsed.has(o) && !nUsed.has(n)) take(o, n, "mutual-best");
  }
  return { pairs, olderUnmatched: freeO(), newerUnmatched: freeN() };
}

// Forward identity assignment over commits OLDEST→NEWEST, with its own quasi-ids.
// `commits` = [{ sha, nodes }]. Returns { idOf:Map<node,quasiId>, births:[{sha,n}], quasiCount }.
export function forwardTrace(commits, opts = {}) {
  const idOf = new Map();
  const births = [];
  let q = 0;
  for (const n of commits[0].nodes) idOf.set(n, `Q${++q}`);
  births.push({ sha: commits[0].sha, n: commits[0].nodes.length }); // all genesis rows are births
  for (let i = 1; i < commits.length; i++) {
    const { pairs } = forwardMatch(commits[i - 1].nodes, commits[i].nodes, opts);
    const paired = new Set();
    for (const p of pairs) { idOf.set(p.newer, idOf.get(p.older) ?? `Q${++q}`); paired.add(p.newer); }
    let born = 0;
    for (const n of commits[i].nodes) if (!idOf.has(n)) { idOf.set(n, `Q${++q}`); born++; }
    births.push({ sha: commits[i].sha, n: born });
  }
  return { idOf, births, quasiCount: q };
}

// The forward pass's predecessor opinion for EVERY newer node across all hops,
// keyed by content-address `${sha}:${contentHash}` (the same scheme the curation
// queue and the diff use). Value = the older node's key, or null for a forward-birth.
// This lets an offline caller join the INDEPENDENT forward decision to a curation
// case by key and ask "did the forward pass name the same predecessor the reverse
// matcher did?" — the basis for the safe forward∩reverse auto-resolution. Pure.
//
// Note on granularity: identical-content older siblings collapse to one key, so a
// match is compared at the content-address level (the unit a recorded decision binds
// to) rather than node identity — exactly what the apply step resolves against.
export function forwardLinks(commits, { floor } = {}) {
  // Subject (newer) side stays plain — it is the caseKey the orchestrator joins on. The
  // PREDECESSOR (older) side uses the occurrence-precise key so it lines up with the curation
  // autoKey for near-identical stubs (occKey collapses to the plain key for unique content).
  const subjKey = (sha, node) => `${sha}:${node.contentHash}`;
  const dupCache = new Map();
  const dupFor = (c) => { let d = dupCache.get(c.sha); if (!d) dupCache.set(c.sha, (d = contentDupCounts(c.nodes))); return d; };
  const out = new Map();
  for (let i = 1; i < commits.length; i++) {
    const olderC = commits[i - 1], newerC = commits[i];
    const { pairs } = forwardMatch(olderC.nodes, newerC.nodes, { floor });
    const byNewer = new Map(pairs.map((p) => [p.newer, p.older]));
    for (const n of newerC.nodes) {
      const o = byNewer.get(n) || null;
      out.set(subjKey(newerC.sha, n), o ? occKey(olderC.sha, o, dupFor(olderC)) : null);
    }
  }
  return out;
}

// Compare the forward (mutual-best) and reverse (matchNodes) passes hop by hop.
// For each NEWER node, who does each pass call its predecessor?
//   agree       both name the same older
//   conflict    both name an older, but DIFFERENT ones  (the real inconsistency)
//   forwardOnly forward paired it, reverse abstained/flagged
//   reverseOnly reverse paired it (often a greedy tier-2.7/3 guess), forward abstained
// Keys are content-addressed `${sha8}:${contentHash}` so the orchestrator can join
// divergences to the curation queue. Pure: returns { tally, divergences }.
export function diffPasses(commits, { floor, recover = false } = {}) {
  const key = (sha, node) => `${sha}:${node.contentHash}`;
  const divergences = [];
  const tally = { hops: 0, newerNodes: 0, agree: 0, conflict: 0, forwardOnly: 0, reverseOnly: 0, bothBirth: 0 };
  for (let i = 1; i < commits.length; i++) {
    const olderC = commits[i - 1], newerC = commits[i];
    const f = forwardMatch(olderC.nodes, newerC.nodes, { floor });
    // reverse mirrors PRODUCTION (recovery on); forward stays the independent method.
    const r = matchNodes(olderC.nodes, newerC.nodes, { recoverByContent: recover });
    const fByNewer = new Map(f.pairs.map((p) => [p.newer, p.older]));
    const rByNewer = new Map();
    for (const p of r.pairs) rByNewer.set(p.newer, { older: p.older, tier: p.tier });
    const rFlagged = new Set(); // newer nodes the reverse matcher flagged ambiguous (its top candidate)
    for (const a of r.ambiguous) if (a.candidates && a.candidates[0]) rFlagged.add(a.candidates[0]);
    tally.hops++;
    for (const n of newerC.nodes) {
      tally.newerNodes++;
      const fo = fByNewer.get(n) || null;
      const rr = rByNewer.get(n);
      const ro = rr?.older || null;
      if (!fo && !ro) { tally.bothBirth++; continue; }
      if (fo && ro && fo === ro) { tally.agree++; continue; }
      const type = fo && ro ? "conflict" : fo ? "forwardOnly" : "reverseOnly";
      tally[type]++;
      divergences.push({
        type, olderSha: olderC.sha, newerSha: newerC.sha,
        newerKey: key(newerC.sha, n), newer: brief(n),
        forwardOlder: fo ? { key: key(olderC.sha, fo), ...brief(fo) } : null,
        reverseOlder: ro ? { key: key(olderC.sha, ro), tier: rr.tier, ...brief(ro) } : null,
        reverseFlaggedAmbiguous: rFlagged.has(n),
      });
    }
  }
  return { tally, divergences };
}

// Rank divergences by how SURPRISING they are: a conflict, or a reverse pairing the
// independent pass couldn't corroborate while reverse was *confident* (tier ≤ 2.5),
// is a stronger bug signal than the expected gray-zone (tier 2.7/3) disagreements.
export function divergencePriority(d) {
  if (d.type === "conflict") return d.reverseOlder && d.reverseOlder.tier <= 2.5 ? 0 : 1;
  if (d.type === "reverseOnly") return d.reverseOlder && d.reverseOlder.tier <= 2.5 ? 0 : 3;
  return 4; // forwardOnly — forward resolved something reverse abstained on
}
