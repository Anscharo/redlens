// Measure the MIP → genesis(2024-09-02) → 4e931dfd(2025-05-28) → current-UUID lineage.
// Run from /Users/m7/lens. Outputs mip-genesis-lineage.json + printed stats.
import fs from "node:fs";
import { parseHtmlToNodes, loadHtmlAt } from "/Users/m7/lens/scripts/htmlhist/atlas-html.mjs";
import { matchNodes } from "/Users/m7/lens/scripts/htmlhist/history-identity.mjs";

const SCRATCH = "/private/tmp/claude-502/-Users-m7-lens/6d7b89bd-66ed-458f-82e7-01cccffb710e/scratchpad";
const REPO = "/Users/m7/lens/vendor/next-gen-atlas";
const ROOT_SHA = "4e931dfd4017a9b9d573dec1aac352e60f1bb02a";

// ---------- text normalization + shingles ----------
const norm = (s) =>
  s.toLowerCase().replace(/[`*_#>|[\]()]/g, " ").replace(/[^a-z0-9.%$-]+/g, " ").trim();
const words = (s) => norm(s).split(/\s+/).filter(Boolean);
const SH = 8;
function shingles(text) {
  const w = words(text);
  const out = new Set();
  for (let i = 0; i + SH <= w.length; i++) out.add(w.slice(i, i + SH).join(" "));
  return out;
}
function containment(smallSet, bigSet) {
  if (!smallSet.size) return 0;
  let hit = 0;
  for (const s of smallSet) if (bigSet.has(s)) hit++;
  return hit / smallSet.size;
}

// ---------- load sources ----------
const genesis = parseHtmlToNodes(fs.readFileSync(`${SCRATCH}/genesis-sky-atlas.html`, "utf8"));
const root = loadHtmlAt(ROOT_SHA, REPO);
const corpus = JSON.parse(fs.readFileSync(`${SCRATCH}/mip-corpus.json`, "utf8"));
const artifact = JSON.parse(fs.readFileSync("/Users/m7/lens/public/history-html-era.json", "utf8"));
const docs = JSON.parse(fs.readFileSync("/Users/m7/lens/public/docs.json", "utf8")).nodes;
console.log(`genesis nodes: ${genesis.length}, root nodes: ${root.length}, mip sections: ${corpus.length}`);

// ---------- MIP shingle indexes ----------
// whole-file sets for attribution + per-section sets for §-level citation
const mipFiles = new Map(); // mip -> { set, title }
const mipSecs = [];
for (const s of corpus) {
  const set = shingles(s.content + " " + (s.title || ""));
  mipSecs.push({ ...s, set });
  if (!mipFiles.has(s.mip)) mipFiles.set(s.mip, { set: new Set(), title: s.mipTitle });
  const f = mipFiles.get(s.mip);
  for (const sh of set) f.set.add(sh);
}
// raw file text for short-doc title fallback
const mipRaw = new Map();
for (const mip of mipFiles.keys()) {
  mipRaw.set(mip, norm(fs.readFileSync(`${SCRATCH}/mips/MIP${mip}/MIP${mip}.md`, "utf8")));
}

// ---------- pass 1: genesis → MIP attribution ----------
const gRecords = genesis.map((g) => {
  const gSet = shingles(g.content || "");
  let best = { mip: null, score: 0 };
  for (const [mip, f] of mipFiles) {
    const c = containment(gSet, f.set);
    if (c > best.score) best = { mip, score: c };
  }
  // title-presence signal against raw MIP text (all docs; distinctive titles only)
  let titleHit = null;
  if (g.title) {
    const t = norm(g.title);
    if (t.length >= 12) {
      for (const [mip, raw] of mipRaw) {
        if (raw.includes(t)) { titleHit = mip; break; }
      }
    }
  }
  // best section within the winning MIP
  let sec = null;
  if (best.mip && best.score > 0) {
    let sBest = { sec: null, title: null, score: 0 };
    for (const s of mipSecs) {
      if (s.mip !== best.mip) continue;
      const c = containment(gSet, s.set);
      if (c > sBest.score) sBest = { sec: s.sec, title: s.title, score: c };
    }
    sec = sBest;
  }
  return {
    section: g.section, docNo: g.doc_no, title: g.title, order: g.order,
    shingleCount: gSet.size,
    mip: best.mip, mipScore: +best.score.toFixed(3),
    mipSec: sec?.sec ?? null, mipSecTitle: sec?.title ?? null, mipSecScore: sec ? +sec.score.toFixed(3) : 0,
    titleHitMip: titleHit,
  };
});

// ---------- pass 2: genesis → root bridge ----------
const m = matchNodes(genesis, root, { seedHop: true, recoverByContent: true });
const tierCounts = {};
for (const p of m.pairs) tierCounts[p.tier] = (tierCounts[p.tier] || 0) + 1;
console.log("genesis→root pairs:", m.pairs.length, "tiers:", JSON.stringify(tierCounts));
console.log("genesis unmatched (died in severed era):", m.olderUnmatched.length,
  "root unmatched (born in severed era):", m.newerUnmatched.length,
  "ambiguous:", m.ambiguous.length, "contained:", m.contained.length);

const rootByGenesisOrder = new Map(); // genesis order -> root node
for (const p of m.pairs) rootByGenesisOrder.set(p.older.order, { node: p.newer, tier: p.tier });

// ---------- pass 3: root rows → uuid via the frozen artifact ----------
const rootSha7 = ROOT_SHA.slice(0, 7);
const addedAtRoot = artifact.events.filter((e) => e.commitHash === rootSha7 && e.changeType === "added");
console.log("artifact added-events at root:", addedAtRoot.length);
// join key (docNo|title); disambiguate collisions by index in stable order
const evByKey = new Map();
for (const e of addedAtRoot) {
  const k = `${e.docNo || ""}|${(e.title || "").toLowerCase()}`;
  if (!evByKey.has(k)) evByKey.set(k, []);
  evByKey.get(k).push(e);
}
const rootSorted = root.slice().sort((a, b) => a.order - b.order);
const uuidByRootOrder = new Map();
const claimIdx = new Map();
for (const r of rootSorted) {
  const k = `${r.doc_no || ""}|${(r.title || "").toLowerCase()}`;
  const evs = evByKey.get(k);
  if (!evs) continue;
  const i = claimIdx.get(k) || 0;
  if (i < evs.length) { uuidByRootOrder.set(r.order, evs[i]); claimIdx.set(k, i + 1); }
}
console.log("root rows resolved to uuid:", uuidByRootOrder.size, "/", root.length);

// ---------- compose ----------
const currentIds = new Set(Object.keys(docs));
for (const rec of gRecords) {
  const hop = rootByGenesisOrder.get(rec.order);
  if (hop) {
    rec.rootTier = hop.tier;
    rec.rootDocNo = hop.node.doc_no;
    rec.rootTitle = hop.node.title;
    const ev = uuidByRootOrder.get(hop.node.order);
    if (ev) {
      rec.docId = ev.docId;
      rec.seam = ev.seam || null;
      rec.synthetic = ev.docId?.[14] === "5" || undefined;
      rec.aliveToday = currentIds.has(ev.docId);
    }
  }
}
fs.writeFileSync(`${SCRATCH}/mip-genesis-lineage.json`, JSON.stringify(gRecords, null, 1));

// ---------- stats ----------
const buckets = { strong: 0, partial: 0, weak: 0, none: 0, stub: 0 };
for (const r of gRecords) {
  if (r.shingleCount < 4) buckets.stub++;
  else if (r.mipScore >= 0.5) buckets.strong++;
  else if (r.mipScore >= 0.25) buckets.partial++;
  else if (r.mipScore > 0.05) buckets.weak++;
  else buckets.none++;
}
console.log("\nMIP containment (genesis docs):", JSON.stringify(buckets));
const perMip = {};
for (const r of gRecords) if (r.mipScore >= 0.25) perMip[r.mip] = (perMip[r.mip] || 0) + 1;
console.log("genesis docs attributed per MIP (score>=0.25):", JSON.stringify(perMip));

const bridged = gRecords.filter((r) => r.docId);
const aliveNow = bridged.filter((r) => r.aliveToday);
const mipAndAlive = aliveNow.filter((r) => r.mipScore >= 0.25 || r.titleHitMip);
const mipContentAlive = aliveNow.filter((r) => r.mipScore >= 0.25);
console.log(`\ngenesis docs bridged to a uuid: ${bridged.length}/${genesis.length}`);
console.log(`genesis docs alive in TODAY's atlas: ${aliveNow.length}`);
console.log(`...MIP-traceable by content (>=0.25): ${mipContentAlive.length}`);
console.log(`...MIP-traceable by content OR title-hit: ${mipAndAlive.length}`);
console.log(`current atlas size: ${currentIds.size} docs`);

// ---------- era breakdown of TODAY's atlas ----------
// birth commit per uuid = its earliest 'added' event in the html-era artifact
const firstAdded = new Map(); // docId -> commit seq
const seqBySha = new Map(artifact.commits.map((c) => [c.sha, c.seq]));
for (const e of artifact.events) {
  if (e.changeType !== "added") continue;
  const seq = seqBySha.get(e.commitHash) ?? Infinity;
  const prev = firstAdded.get(e.docId);
  if (prev === undefined || seq < prev) firstAdded.set(e.docId, seq);
}
const genesisAliveIds = new Set(aliveNow.map((r) => r.docId));
let bornPreGenesis = 0, bornSevered = 0, bornHtmlGit = 0, bornMdEra = 0;
for (const id of currentIds) {
  if (genesisAliveIds.has(id)) { bornPreGenesis++; continue; }
  const seq = firstAdded.get(id);
  if (seq === undefined) { bornMdEra++; continue; } // no html-era event → post-#117
  if (seq === 1) bornSevered++; // present at 4e931dfd but not in genesis → born 2024-09-02..2025-05-28
  else bornHtmlGit++; // born during the recoverable HTML era
}
console.log(`\nTODAY's atlas era breakdown (${currentIds.size} docs):`);
console.log(`  born at/before genesis 2024-09-02:     ${bornPreGenesis}`);
console.log(`   ...of which MIP-content-traceable:    ${mipContentAlive.length}`);
console.log(`   ...content-or-title traceable:        ${mipAndAlive.length}`);
console.log(`  born in severed era (genesis→root):    ${bornSevered}`);
console.log(`  born in git HTML era (root→#117):      ${bornHtmlGit}`);
console.log(`  born in markdown era (post-#117):      ${bornMdEra}`);

// diagnostics: what does the "none" bucket look like?
const none = gRecords.filter((r) => r.shingleCount >= 4 && r.mipScore <= 0.05);
const byArticle = {};
for (const r of none) {
  const k = `${r.section}:${r.docNo || "?"}`;
  byArticle[k] = (byArticle[k] || 0) + 1;
}
const top = Object.entries(byArticle).sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log("\ntop no-MIP-match clusters (section:docNo count):");
for (const [k, c] of top) console.log(" ", k, c);
console.log("\nsample none titles:", none.slice(0, 15).map((r) => `${r.docNo} ${r.title}`).join(" | "));
