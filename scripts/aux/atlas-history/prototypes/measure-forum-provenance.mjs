// Measure forum→doc association strength for Phase B (stage 3).
// Reads ONLY committed in-repo data (no scratch deps). Run from /Users/m7/lens:
//   node scripts/aux/atlas-history/prototypes/measure-forum-provenance.mjs
// Emits recovered/forum-provenance-measure.json + prints the human summary.
//
// Answers: (1) how many severed-born-alive docs get any forum title evidence,
// (2) what fraction of those title matches COLLIDE with >1 current doc (the FP
// mechanism), (3) the high-trust subset = explicit edit-set bullet ∩ unique
// title ∩ not-at-genesis, (4) de-collision via 8-word body-shingle containment
// (Gate-4 machinery) — which both rescues links AND detects title-only FPs.
import fs from "node:fs";

const ROOT = "/Users/m7/lens";
const PROP = `${ROOT}/scripts/aux/atlas-history/severed-proposals`;
const OUT = `${ROOT}/scripts/aux/atlas-history/recovered/forum-provenance-measure.json`;
const pre = JSON.parse(fs.readFileSync(`${ROOT}/public/history-pre-era.json`, "utf8"));
const docs = JSON.parse(fs.readFileSync(`${ROOT}/public/docs.json`, "utf8")).nodes;
const cov = JSON.parse(fs.readFileSync(`${ROOT}/scripts/aux/atlas-history/recovered/forum-coverage.json`, "utf8"));
const dateOf = new Map(cov.proposals.map((p) => [p.id, p.date]));

// title key (collision/keying) vs content shingles (Gate-4: SH=8)
const ntNorm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const cNorm = (s) => s.toLowerCase().replace(/[`*_#>|[\]()]/g, " ").replace(/[^a-z0-9.%$-]+/g, " ").trim();
const words = (s) => cNorm(s).split(/\s+/).filter(Boolean);
const SH = 8;
const shingles = (t) => { const w = words(t), o = new Set(); for (let i = 0; i + SH <= w.length; i++) o.add(w.slice(i, i + SH).join(" ")); return o; };
const containment = (a, b) => { if (!a.size) return 0; let h = 0; for (const s of a) if (b.has(s)) h++; return h / a.size; };

// ---- current-atlas title collision index ----
const titleToDocs = new Map();
for (const id of Object.keys(docs)) {
  const t = ntNorm(docs[id].title || ""); if (!t) continue;
  (titleToDocs.get(t) || titleToDocs.set(t, []).get(t)).push(id);
}

// ---- severed-born-alive docs + genesis titles ----
const genesisTitles = new Set();
for (const e of pre.events) if (e.era === "genesis" && docs[e.docId]) genesisTitles.add(ntNorm(docs[e.docId].title || ""));
const severed = [];
for (const e of pre.events) {
  if (e.era !== "severed" || !docs[e.docId]) continue;
  const d = docs[e.docId];
  severed.push({ id: e.docId, title: d.title || "", docNo: d.doc_no || "", nt: ntNorm(d.title || "") });
}

// ---- extract edit-set evidence per proposal ----
// gen-3 nested doc bullet: "- **Title** *(Type)* - inline-body" (+ continuation prose)
const BULLET = /^(\s*)[-*] \*\*(.{2,120}?)\*\*\s*[(*]{1,3}\s*\(?([A-Z][\w /]{1,30}?)\)?\s*[)*]{1,3}\s*[-–]\s*(.*)/;
// gen-1 explicit header: "**§Add new document: A.x - Title**"
const ADD_HDR = /\*\*\s*§?\s*(?:Add|Adds|Introduce)[^*]*?[Dd]ocument[^*]*?:\s*(A\.[0-9][0-9.]*)?\s*[-–]?\s*([^*]+?)\s*\*\*/g;
const EDITSET = /^#{2,4}\s+(.*)/;

const bulletHits = new Map();   // nt -> [{pid, body}]
const addHdr = new Map();       // nt -> {pid, docNo}
const setName = new Set();      // nt of edit-set headings
const proseText = [];           // {pid, ntext}
for (const f of fs.readdirSync(PROP).filter((x) => x.endsWith(".md"))) {
  const pid = +f.replace(".md", "");
  const text = fs.readFileSync(`${PROP}/${f}`, "utf8");
  proseText.push({ pid, ntext: ntNorm(text) });
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const b = lines[i].match(BULLET);
    if (b) {
      const indent = b[1].length; let body = b[4] || "";
      for (let j = i + 1; j < lines.length; j++) {
        const ln = lines[j];
        if (!ln.trim()) { body += "\n"; continue; }
        const lead = ln.match(/^(\s*)/)[1].length;
        if (lead <= indent || /^\s*[-*] /.test(ln)) break; // stop at sibling/child bullet — keep own prose
        body += " " + ln.trim();
      }
      const nt = ntNorm(b[2]);
      (bulletHits.get(nt) || bulletHits.set(nt, []).get(nt)).push({ pid, body });
    }
    const h = lines[i].match(EDITSET);
    if (h) setName.add(ntNorm(h[1]));
  }
  let m; ADD_HDR.lastIndex = 0;
  while ((m = ADD_HDR.exec(text))) { const t = ntNorm(m[2] || ""); if (t.length >= 4) addHdr.set(t, { pid, docNo: m[1] || "" }); }
}

// ---- tier + collision classification ----
const tierOf = (nt) => addHdr.has(nt) ? "A_addHeader" : bulletHits.has(nt) ? "B_bullet" : setName.has(nt) ? "C_editSetName" : (nt.length >= 10 && proseText.some((p) => p.ntext.includes(nt))) ? "D_prose" : "none";
const tiers = {}; let uniqueCovered = 0, collideCovered = 0, alsoGenesis = 0;
for (const d of severed) {
  const tier = tierOf(d.nt); tiers[tier] = (tiers[tier] || 0) + 1;
  if (tier === "none") continue;
  const freq = (titleToDocs.get(d.nt) || []).length;
  if (freq > 1) collideCovered++; else uniqueCovered++;
  if (genesisTitles.has(d.nt)) alsoGenesis++;
}
const covered = severed.length - (tiers.none || 0);

// ---- (a) high-trust subset ----
const highTrust = [];
for (const d of severed) {
  const isBullet = bulletHits.has(d.nt), isHdr = addHdr.has(d.nt);
  if (!isBullet && !isHdr) continue;
  if ((titleToDocs.get(d.nt) || []).length !== 1) continue;
  if (genesisTitles.has(d.nt)) continue;
  const hits = bulletHits.get(d.nt) || [];
  const pids = [...new Set([...(isHdr ? [addHdr.get(d.nt).pid] : []), ...hits.map((h) => h.pid)])];
  highTrust.push({ docId: d.id, docNo: d.docNo, title: d.title, tier: isHdr ? "addHdr" : "bullet", pids, dates: pids.map((p) => dateOf.get(p) || "?") });
}
highTrust.sort((a, b) => a.docNo.localeCompare(b.docNo, undefined, { numeric: true }));

// ---- (b) de-collision on bulleted-but-colliding docs ----
const MIN_ABS = 0.10, MARGIN = 0.05;
const colliders = severed.filter((d) => bulletHits.has(d.nt) && (titleToDocs.get(d.nt) || []).length > 1 && !genesisTitles.has(d.nt));
let rescued = 0, notWinner = 0, ambiguous = 0, weakBody = 0;
const rescueRows = [];
for (const d of colliders) {
  const body = (bulletHits.get(d.nt) || []).map((h) => h.body).sort((a, b) => b.length - a.length)[0] || "";
  const bodyS = shingles(body);
  if (bodyS.size < 4) { weakBody++; continue; }
  const cands = titleToDocs.get(d.nt).map((id) => ({ id, c: containment(bodyS, shingles(docs[id].content || "")) })).sort((a, b) => b.c - a.c);
  const top = cands[0], runner = cands[1] || { c: 0 };
  if (top.c < MIN_ABS) { weakBody++; continue; }
  if (top.id !== d.id) { notWinner++; continue; }
  if (top.c - runner.c < MARGIN) { ambiguous++; continue; }
  rescued++;
  const pids = [...new Set((bulletHits.get(d.nt) || []).map((h) => h.pid))];
  rescueRows.push({ docId: d.id, docNo: d.docNo, title: d.title, self: +top.c.toFixed(3), runner: +runner.c.toFixed(3), nCands: cands.length, pids, dates: pids.map((p) => dateOf.get(p) || "?") });
}

const result = {
  measuredAt: "2026-07-07",
  severedBornAlive: severed.length,
  titleEvidence: { covered, tiers, uniqueCovered, collideCovered, alsoGenesis, collideFraction: +(collideCovered / covered).toFixed(3) },
  highTrust: { count: highTrust.length, rows: highTrust },
  deCollision: { candidates: colliders.length, rescued, rejectedSiblingBetter: notWinner, ambiguous, weakBody, falsePositiveFraction: +(notWinner / colliders.length).toFixed(3), rows: rescueRows },
  trustworthyTotal: highTrust.length + rescued,
  thresholds: { MIN_ABS, MARGIN, SH },
};
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));

console.log(`severed-born ALIVE docs: ${severed.length}`);
console.log(`title evidence (any tier): ${covered} (${Math.round(100 * covered / severed.length)}%)  tiers=${JSON.stringify(tiers)}`);
console.log(`  unique-title: ${uniqueCovered}   COLLIDE(>1 doc): ${collideCovered} (${Math.round(100 * collideCovered / covered)}% of covered)   also-at-genesis: ${alsoGenesis}`);
console.log(`(a) HIGH-TRUST (bullet ∩ unique ∩ !genesis): ${highTrust.length}`);
console.log(`(b) DE-COLLISION on ${colliders.length} colliding bulleted docs:`);
console.log(`    rescued=${rescued}  rejected(sibling better, = caught FP)=${notWinner} (${Math.round(100 * notWinner / colliders.length)}%)  ambiguous=${ambiguous}  weakBody=${weakBody}`);
console.log(`>>> trustworthy per-doc links: ${highTrust.length} + ${rescued} = ${result.trustworthyTotal}`);
console.log(`wrote ${OUT}`);
