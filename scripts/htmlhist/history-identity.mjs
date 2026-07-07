// Tiered content-pairing matcher (plan §4.2). Pure + testable. Reused at every
// backward HTML→HTML hop, at the #117 seed boundary (seedHop), and by §8 slot-reuse.
//
// Tiers, cheapest-first:
//   1   exact contentHash, with POSITIONAL alignment inside an identical-hash
//       bucket (k-th older ↔ k-th newer) — resolves duplicated boilerplate that a
//       naive matcher would call ambiguous.
//   2   structural key, unique on both sides (a modified row whose identity holds).
//   2.5 structural-key BUCKET of equal size → ordered alignment (the Agent Scope
//       DB deep hierarchy, §4.2). Unequal-size bucket = a genuine insert/delete →
//       deferred to fuzzy rather than guessed.
//   3   fuzzy on the residual within a section (shingle Jaccard), with contention
//       detection. Confident + uncontended → pair; else → the §10.4 decision queue.
//   4   containment / sub-node (seedHop only): a newer body contained in an older
//       parent → a `split` link, not a pairing.
//
// Returns { pairs, ambiguous, contained, olderUnmatched, newerUnmatched }.
//   pairs:     [{ older, newer, tier }]            tier ∈ 1 | 2 | 2.5 | 3
//   ambiguous: [{ older, candidates, reason, score? }]   reason ∈ fuzzy | contention | bucket-resize
//   contained: [{ newer, parent, coverage }]       (seedHop only)

import crypto from "node:crypto";
import { sameDocScore } from "./ordered-containment.mjs";

const SH = 8; // shingle width (words)

// ---- deterministic synthetic UUIDs (plan §4.3) ------------------------------
// HTML-era rows with no real #117 uuid4 (mid-era deaths, merged rows) get a
// deterministic uuid v5 — REPRO-safe (no randomUUID), and its version nibble `5`
// makes it trivially distinguishable from the real `4`s. Minted ONCE at the row's
// newest occurrence (firstSeenSha) and carried back unchanged.
const NS_ATLAS_HTML = "7b3f9c10-5d8e-4a21-9f6b-2c4d8e0a1b3c";
const uuidToBytes = (u) => { const h = u.replace(/-/g, ""); const b = Buffer.alloc(16); for (let i = 0; i < 16; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16); return b; };
const bytesToUuid = (b) => { const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };

export function uuidv5(name, namespace = NS_ATLAS_HTML) {
  const hash = crypto.createHash("sha1").update(Buffer.concat([uuidToBytes(namespace), Buffer.from(name, "utf8")])).digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC variant
  return bytesToUuid(b);
}

/** Deterministic identity for a row with no real #117 uuid (plan §4.3).
 *  A doc with an EMPTY breadcrumb (a template child like "Required Primitive Inputs") otherwise
 *  collides with the same-titled, same-content child of EVERY other process — 39% of HTML rows are
 *  content-duplicates, including 60+-word boilerplate paragraphs, so title+content+section is not a
 *  unique identity. Its only stable distinguisher is the owning parent recovered by position
 *  (node.parentTitle, from atlas-html.mjs) — NOT the row's line/order, which shifts every commit and
 *  would re-mint the id on every edit. Substitute the parent into the ancestry slot for orphans only;
 *  docs that carry their own breadcrumb keep the exact same id as before. */
export function syntheticUuid(node, firstSeenSha) {
  const ancestors = node.ancestors || [];
  const ancestry = ancestors.length ? ancestors.join(">") : (node.parentTitle || "");
  return uuidv5(`${node.section}|${ancestry}|${node.title}|${node.contentHash}|${firstSeenSha}`);
}

/** True for the synthetic v5 ids (vs real v4 from #117). */
export const isSynthetic = (uuid) => typeof uuid === "string" && uuid[14] === "5";

const words = (s) => (s ? s.split(/\s+/).filter(Boolean) : []);
const isShort = (n) => words(n.content).length < SH;

function shingleSet(node, cache) {
  let s = cache.get(node);
  if (s) return s;
  const w = words(node.content);
  s = new Set();
  for (let i = 0; i + SH <= w.length; i++) s.add(w.slice(i, i + SH).join(" "));
  cache.set(node, s);
  return s;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
const byField = (rows, field) => {
  const m = new Map();
  for (const r of rows) {
    const k = r[field];
    let g = m.get(k);
    if (!g) m.set(k, (g = []));
    g.push(r);
  }
  return m;
};
const byOrder = (a, b) => a.order - b.order;

export function matchNodes(older, newer, opts = {}) {
  const { fuzzyHi = 0.6, fuzzyLo = 0.3, fuzzyMargin = 0.15, seedHop = false, recoverByContent = false, recoverHi = 0.85, diffEdits = null } = opts;
  const pairs = [], ambiguous = [], contained = [];
  const oUsed = new Set(), nUsed = new Set();
  const cache = new Map();
  const freeO = () => older.filter((o) => !oUsed.has(o));
  const freeN = () => newer.filter((n) => !nUsed.has(n));
  const take = (o, n, tier) => { oUsed.add(o); nUsed.add(n); pairs.push({ older: o, newer: n, tier }); };

  // ---- tier 1.7 (opt-in): diff-confirmed edits, applied FIRST. A CONTENT CHANGE that the
  // section-scoped LCS anchored to a single older↔newer pair (diffEdits, from history-diff.mjs)
  // is a high-confidence edit: the unchanged neighbors pin its position and a structural-key /
  // content-overlap gate proves identity — even for near-identical Agent Scope DB siblings that
  // tier-1's positional bucket mispairs. Claiming these BEFORE tier 1 removes them from the
  // identical-hash pool, so they can't be mis-aligned. Measured (2026-07, 78 hops): resolves 40
  // matcher-ambiguous cases + fixes 6 mispairings, never worse than the matcher. Off unless the
  // caller passes diffEdits — so every other matchNodes() caller is unchanged.
  if (diffEdits && diffEdits.size) {
    for (const [o, n] of diffEdits) if (!oUsed.has(o) && !nUsed.has(n)) take(o, n, 1.7);
  }

  // ---- tier 1: exact content, positional alignment within identical-hash bucket
  {
    const oH = byField(older, "contentHash"), nH = byField(newer, "contentHash");
    for (const [h, oG] of oH) {
      const nG = nH.get(h);
      if (!nG) continue;
      const os = oG.slice().sort(byOrder), ns = nG.slice().sort(byOrder);
      const k = Math.min(os.length, ns.length);
      for (let i = 0; i < k; i++) take(os[i], ns[i], 1); // k-th ↔ k-th
      // leftover (|os|≠|ns|) stays unmatched: a duplicated row added/removed
    }
  }

  // ---- tier 2 / 2.5: structural-key buckets on the residual
  {
    const oK = byField(freeO(), "structuralKey"), nK = byField(freeN(), "structuralKey");
    for (const [key, oGall] of oK) {
      const nGall = nK.get(key);
      if (!key || !nGall) continue;
      const oG = oGall.filter((o) => !oUsed.has(o)).sort(byOrder);
      const nG = nGall.filter((n) => !nUsed.has(n)).sort(byOrder);
      if (!oG.length || !nG.length) continue;
      if (oG.length === 1 && nG.length === 1) {
        take(oG[0], nG[0], 2); // unique key, modified content
      } else if (oG.length === nG.length) {
        for (let i = 0; i < oG.length; i++) take(oG[i], nG[i], 2.5); // stable bucket → order
      } else {
        // tier 2.7: unequal-size key bucket (a near-identical Agent Scope DB
        // sibling was inserted/removed). Positional/lookahead alignment was
        // MEASURED at ~45% accuracy (2026-06-26) — worse than a coin flip — so we
        // DO NOT guess. Pair only high-confidence content matches; flag the rest
        // as ambiguous for verification. "Flag, never guess" for the zero-
        // tolerance bar.
        const sh = (x) => shingleSet(x, cache);
        for (const o of oG) {
          let best = null, bs = 0;
          for (const n of nG) { if (nUsed.has(n)) continue; const s = jaccard(sh(o), sh(n)); if (s > bs) { bs = s; best = n; } }
          if (best && bs >= fuzzyHi) take(o, best, 2.7);                                          // same key + ≥0.6 content overlap → confident
          else { ambiguous.push({ older: o, candidates: best ? [best] : [], reason: "bucket-resize", score: +bs.toFixed(3) }); oUsed.add(o); } // flag
        }
      }
    }
  }

  // ---- tier 3: fuzzy on the residual, within a section, with contention guard
  {
    const residN = freeN().filter((n) => !isShort(n));
    const nBySec = byField(residN, "section");
    // best newer per older
    const proposals = []; // {o, n, score}
    for (const o of freeO()) {
      if (isShort(o)) continue;
      const cands = (nBySec.get(o.section) || []).filter((n) => !nUsed.has(n));
      if (!cands.length) continue;
      const oSh = shingleSet(o, cache);
      let best = null, bs = 0, second = 0;
      for (const n of cands) {
        const sc = jaccard(oSh, shingleSet(n, cache));
        if (sc > bs) { second = bs; bs = sc; best = n; } else if (sc > second) second = sc;
      }
      if (bs >= fuzzyLo) proposals.push({ o, n: best, score: bs, margin: bs - second });
    }
    // contention: a newer claimed by >1 older
    const claims = new Map();
    for (const p of proposals) (claims.get(p.n) || claims.set(p.n, []).get(p.n)).push(p);
    for (const p of proposals.sort((a, b) => b.score - a.score)) {
      if (oUsed.has(p.o) || nUsed.has(p.n)) continue;
      const contended = (claims.get(p.n) || []).filter((q) => !oUsed.has(q.o)).length > 1;
      if (p.score >= fuzzyHi && p.margin >= fuzzyMargin && !contended) {
        take(p.o, p.n, 3);
      } else {
        ambiguous.push({ older: p.o, candidates: [p.n], reason: contended ? "contention" : "fuzzy", score: +p.score.toFixed(3) });
        oUsed.add(p.o); // surfaced for §10.4; not auto-paired
      }
    }
  }

  // ---- tier 3.5 (opt-in): content recovery for renames/restructures (matcher-recall).
  // A BULK rename changes titles/structural-keys en masse, so tiers 2/2.5 miss and tier-3's
  // contention guard refuses to guess among the many simultaneously-shifting siblings —
  // dropping real continuations to death+birth (measured: 267, 0% kept their key, 95%
  // same-section). Ordered containment (sameDocScore) is key/title-blind, so a MUTUAL-BEST
  // pair ≥ recoverHi within a section recovers them. OFF by default: it changes historical
  // identity, so callers opt in (and re-flow the thread) deliberately.
  if (recoverByContent) {
    const ro = freeO().filter((o) => !isShort(o)), rn = freeN().filter((n) => !isShort(n));
    const rnBySec = byField(rn, "section"), roBySec = byField(ro, "section");
    const bestIn = (node, pool) => {
      let b = null, bs = 0;
      for (const x of pool) { const s = sameDocScore(node.content, x.content); if (s > bs) { bs = s; b = x; } }
      return b && bs >= recoverHi ? b : null;
    };
    const bestNewer = new Map(); for (const o of ro) { const n = bestIn(o, rnBySec.get(o.section) || []); if (n) bestNewer.set(o, n); }
    const bestOlder = new Map(); for (const n of rn) { const o = bestIn(n, roBySec.get(n.section) || []); if (o) bestOlder.set(n, o); }
    for (const [o, n] of bestNewer) if (bestOlder.get(n) === o && !oUsed.has(o) && !nUsed.has(n)) take(o, n, 3.5);
  }

  // ---- tier 4: containment / sub-node (seed hop only) — split detection
  if (seedHop) {
    const oBlob = older.map((o) => o.content).join("\n");
    for (const n of freeN()) {
      if (isShort(n)) continue;
      const sh = [...shingleSet(n, cache)];
      const hit = sh.filter((s) => oBlob.includes(s)).length / sh.length;
      if (hit >= 0.6) {
        // find the best-covering older parent (same section preferred)
        let parent = null, bestCov = 0;
        for (const o of older) {
          if (!o.content || words(o.content).length < SH) continue;
          const cov = sh.filter((s) => o.content.includes(s)).length / sh.length;
          if (cov > bestCov) { bestCov = cov; parent = o; }
        }
        contained.push({ newer: n, parent, coverage: +hit.toFixed(3) });
        nUsed.add(n);
      }
    }
  }

  return {
    pairs,
    ambiguous,
    contained,
    olderUnmatched: freeO(),
    newerUnmatched: freeN(),
  };
}

export const _internal = { shingleSet, jaccard, isShort, words };
