// Gate 2: corroborate every non-tier-1 genesis→root bridge pair with an
// independent second signal (sameDocScore: order-preserving word containment,
// key/title-blind). Lock = two-signal agreement; everything else → curation queue.
import fs from "node:fs";
import { parseHtmlToNodes, loadHtmlAt } from "/Users/m7/lens/scripts/htmlhist/atlas-html.mjs";
import { matchNodes } from "/Users/m7/lens/scripts/htmlhist/history-identity.mjs";
import { sameDocScore } from "/Users/m7/lens/scripts/htmlhist/ordered-containment.mjs";

const GENESIS = "/Users/m7/lens/scripts/aux/atlas-history/recovered/genesis-2024-09-02.html";
const REPO = "/Users/m7/lens/vendor/next-gen-atlas";
const ROOT_SHA = "4e931dfd4017a9b9d573dec1aac352e60f1bb02a";
const OUT = "/Users/m7/lens/scripts/aux/atlas-history/recovered/gate2-bridge-corroboration.json";

const genesis = parseHtmlToNodes(fs.readFileSync(GENESIS, "utf8"));
const root = loadHtmlAt(ROOT_SHA, REPO);
const m = matchNodes(genesis, root, { seedHop: true, recoverByContent: true });

const normT = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const CORROB_HI = 0.6; // sameDocScore agreement bar
const pairs = [];
for (const p of m.pairs) {
  const rec = {
    tier: p.tier,
    gOrder: p.older.order, gTitle: p.older.title, gDocNo: p.older.doc_no, gSection: p.older.section,
    rOrder: p.newer.order, rTitle: p.newer.title, rDocNo: p.newer.doc_no,
    gWords: (p.older.content || "").split(/\s+/).filter(Boolean).length,
  };
  if (p.tier === 1) { rec.verdict = "lock:exact-content"; pairs.push(rec); continue; }
  // signal 2a: title-blind ordered word containment on content
  rec.sameDoc = +sameDocScore(p.older.content || "", p.newer.content || "").toFixed(3);
  // signal 2b: exact normalized title match (independent of the fuzzy content signal
  // for tier 3, and of the structural key's ancestors for tier 2 only partially —
  // note title participates in structuralKey, so for tier 2/2.5 the INDEPENDENT
  // signal is content containment, not title)
  rec.titleEq = normT(p.older.title) === normT(p.newer.title);
  const contentAgrees = rec.sameDoc >= CORROB_HI;
  const shortDoc = rec.gWords < 12; // stubs: containment unreliable either way
  if (p.tier === 2 || p.tier === 2.5) {
    // structural key already includes title+ancestors → need content agreement
    rec.verdict = contentAgrees ? "lock:structural+content"
      : shortDoc && rec.titleEq ? "lock:structural-stub-titleeq"
      : "queue";
  } else {
    // fuzzy/recovery tiers (2.7, 3, 3.5): content found the pair → need the
    // independent structural/title signal
    rec.verdict = rec.titleEq ? "lock:fuzzy+title"
      : contentAgrees ? "lock:fuzzy+containment"
      : "queue";
  }
  pairs.push(rec);
}

const nonT1 = pairs.filter((p) => p.tier !== 1);
const verdictCounts = {};
for (const p of nonT1) verdictCounts[p.verdict] = (verdictCounts[p.verdict] || 0) + 1;
console.log("non-tier-1 pairs:", nonT1.length);
console.log("verdicts:", JSON.stringify(verdictCounts, null, 1));
const queued = nonT1.filter((p) => p.verdict === "queue");
console.log("\nqueued pairs (need human/curation):");
for (const q of queued) console.log(`  t${q.tier} sameDoc=${q.sameDoc} titleEq=${q.titleEq} words=${q.gWords} | ${q.gDocNo || "?"} ${q.gTitle}  ->  ${q.rDocNo || "?"} ${q.rTitle}`);

// also snapshot the ambiguous + contained queues for the artifact
const queues = {
  ambiguous: m.ambiguous.map((a) => ({
    gTitle: a.older?.title ?? a.title, gDocNo: a.older?.doc_no ?? a.doc_no,
    candidates: (a.candidates || []).slice(0, 4).map((c) => c.title),
    reason: a.reason,
  })),
  contained: m.contained.map((c) => ({
    gTitle: c.older?.title ?? c.title, container: c.newer?.title ?? c.container?.title,
  })),
};
fs.writeFileSync(OUT, JSON.stringify({
  gate: 2, date: "2026-07-06", corroborator: "sameDocScore (ordered word containment, title-blind) + exact-title",
  thresholds: { CORROB_HI, shortDocWords: 12 },
  counts: { pairs: pairs.length, tier1: pairs.length - nonT1.length, nonTier1: nonT1.length, verdicts: verdictCounts },
  nonTier1Pairs: nonT1, queues,
}, null, 1));
console.log(`\nwrote ${OUT}`);
