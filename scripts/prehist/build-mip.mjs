#!/usr/bin/env bun
// prehist:mip — Stage 2 (docs/plans/pre-git-history.md): attribute genesis-era docs
// to the MIP-era Atlas (MIP101 + the five scope BMAAs, 2023-02 → 2024-09) by content
// shingle containment. Reads the COMMITTED mip corpus + section dates (no network, no
// mips-clone dependency — deterministic and offline, matching the frozen-artifact
// philosophy of the genesis HTML) and the `bridge` section build-genesis.mjs wrote
// into public/history-pre-era.json, so this stage never re-runs the expensive
// genesis→root threading.
//
//   bun scripts/prehist/build-mip.mjs             # append mip events, write the artifact
//   bun scripts/prehist/build-mip.mjs --measure   # print stats, write nothing
//
// Run AFTER prehist:genesis (which writes the `bridge` section this stage reads).

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/history-pre-era.json");
const CORPUS_PATH = path.join(ROOT, "scripts/aux/atlas-history/recovered/mip-corpus.json");
const DATES_PATH = path.join(ROOT, "scripts/aux/atlas-history/recovered/mip-section-dates.json");
const MEASURE = process.argv.includes("--measure");

// Gate-4 calibrated auto-lock line (74 labeled docs, 98.4% strict precision combined):
// low containment means heavy rewriting, not wrong attribution — see
// scripts/aux/atlas-history/recovered/gate4-mip-calibration.json.
const AUTO_LOCK = 0.05;
// Gate-5 combined-signal lock (2026-07-07, full population of 8 reviewed — not a
// sample): title-hit ALONE never locks (Gate 4: one wrong-MIP case), but title-hit
// AND a nonzero content score IN THE SAME MIP does — 7/8 strict TRUE + 1 PARTIAL,
// zero FALSE, zero wrong-MIP. See gate5-titlehit-combined-calibration.json. Title-hit
// pointing at a DIFFERENT mip than the best content score is NOT covered by this
// calibration and still never locks.
const TITLE_HIT_MIN_CHARS = 8;
const MIP_RATIFICATION_FALLBACK = "2023-03-27";
const MIP_SEQ_BASE = -30000;
const MIPS_REPO = "https://github.com/sky-ecosystem/mips/blob/master"; // default branch is master, not main

// ---------- shingle containment (same 8-word scheme as the measurement prototype) ----------
const norm = (s) => s.toLowerCase().replace(/[`*_#>|[\]()]/g, " ").replace(/[^a-z0-9.%$-]+/g, " ").trim();
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

if (!fs.existsSync(OUT)) {
  console.error(`${path.relative(ROOT, OUT)} not found — run \`pnpm prehist:genesis\` first (this stage reads its "bridge" section).`);
  process.exit(1);
}
const artifact = JSON.parse(fs.readFileSync(OUT, "utf8"));
if (!artifact.bridge || !artifact.bridge.length) {
  console.error(`${path.relative(ROOT, OUT)} has no "bridge" section — re-run \`pnpm prehist:genesis\`.`);
  process.exit(1);
}
const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, "utf8"));
const sectionDates = JSON.parse(fs.readFileSync(DATES_PATH, "utf8"));
console.error(`bridge docs: ${artifact.bridge.length}, mip sections: ${corpus.length}`);

// whole-file shingle sets (attribution) + per-section sets (§-level citation) +
// raw normalized text per mip (title-hit substring check, Gate 5)
const mipFiles = new Map(); // mip -> Set<shingle>
const mipRaw = new Map(); // mip -> concatenated normalized raw text
const mipSecs = corpus.map((s) => ({ ...s, set: shingles(`${s.content} ${s.title || ""}`) }));
for (const s of mipSecs) {
  if (!mipFiles.has(s.mip)) { mipFiles.set(s.mip, new Set()); mipRaw.set(s.mip, ""); }
  const f = mipFiles.get(s.mip);
  for (const sh of s.set) f.add(sh);
  mipRaw.set(s.mip, mipRaw.get(s.mip) + " " + norm(`${s.content} ${s.title || ""}`));
}

// ---------- attribute every bridged doc ----------
const attributed = []; // { docId, mip, mipScore, sec, secTitle, secScore, date, via }
let titleHitLocked = 0, hintOnly = 0;
for (const doc of artifact.bridge) {
  const dSet = shingles(doc.content || "");
  let best = { mip: null, score: 0 };
  for (const [mip, set] of mipFiles) {
    const c = containment(dSet, set);
    if (c > best.score) best = { mip, score: c };
  }
  let via = "content";
  if (best.score < AUTO_LOCK) {
    if (best.score <= 0) continue; // no signal at all
    // Gate 5: title-hit + nonzero content IN THE SAME MIP locks even below AUTO_LOCK.
    // Title-hit alone (no content agreement in this mip) still never locks — that's
    // exactly the combination Gate 4 measured a wrong-MIP case for.
    const titleNorm = norm(doc.title || "");
    const titleHit = titleNorm.length >= TITLE_HIT_MIN_CHARS && mipRaw.get(best.mip)?.includes(titleNorm);
    if (!titleHit) { hintOnly++; continue; }
    via = "titleHit+content";
    titleHitLocked++;
  }
  // best section within the winning MIP
  let sBest = { sec: null, title: null, score: 0 };
  for (const s of mipSecs) {
    if (s.mip !== best.mip) continue;
    const c = containment(dSet, s.set);
    if (c > sBest.score) sBest = { sec: s.sec, title: s.title, score: c };
  }
  const dateKey = `${best.mip}:${sBest.sec || sBest.title}`;
  const dated = sectionDates[dateKey];
  attributed.push({
    docId: doc.docId, mip: best.mip, mipScore: +best.score.toFixed(3),
    sec: sBest.sec, secTitle: sBest.title, secScore: +sBest.score.toFixed(3),
    date: dated?.date ?? MIP_RATIFICATION_FALLBACK, via,
  });
}
console.error(`attributed: ${attributed.length}/${artifact.bridge.length} (${attributed.length - titleHitLocked} by content >= ${AUTO_LOCK}, ${titleHitLocked} by title-hit+content — Gate 5); ${hintOnly} below the line with no title-hit corroboration (curation hint only, not emitted)`);

// ---------- baked ordering: earliest MIP-section date -> most negative seq ----------
const distinctDates = [...new Set(attributed.map((a) => a.date))].sort();
const rankByDate = new Map(distinctDates.map((d, i) => [d, i]));

const mipEvents = attributed.map((a) => {
  const cite = a.sec ? `§${a.sec}` : a.secTitle ? `"${a.secTitle}"` : "";
  const ev = {
    docId: a.docId,
    commitHash: `mip:${a.mip}:${a.sec ?? a.secTitle ?? "root"}`,
    commitSeq: MIP_SEQ_BASE + rankByDate.get(a.date),
    changeType: "added",
    era: "mip",
    date: a.date,
    summary: `Proposed in MIP${a.mip}${cite ? ` ${cite}` : ""}`,
    sourceUrl: `${MIPS_REPO}/MIP${a.mip}/MIP${a.mip}.md`,
  };
  // Gate 5 title-hit+content locks were reviewed individually (side-by-side text,
  // per-item rationale), not purely threshold-crossed — reuse the existing method
  // badge (ai/human) so the UI distinguishes them, no new plumbing needed.
  if (a.via === "titleHit+content") ev.method = "ai";
  return ev;
});

const byMip = {};
for (const a of attributed) byMip[a.mip] = (byMip[a.mip] || 0) + 1;
console.error("attributed per MIP:", JSON.stringify(byMip));

if (MEASURE) {
  console.error("\n--measure: artifact NOT written.");
} else {
  // Idempotent re-run: drop any mip events from a PRIOR run of this stage before
  // appending the fresh set, so `prehist:mip` can be re-run on its own (e.g. after
  // fixing a source_url typo) without needing prehist:genesis first and without
  // duplicating (doc_id, commit_sha, change_type) keys on upsert.
  const priorMipCount = (artifact.events || []).filter((e) => e.era === "mip").length;
  if (priorMipCount) console.error(`dropping ${priorMipCount} mip events from a prior run`);
  artifact.events = [...(artifact.events || []).filter((e) => e.era !== "mip"), ...mipEvents];
  artifact.meta = { ...(artifact.meta || {}), mip: { attributed: attributed.length, byMip, autoLock: AUTO_LOCK, titleHitLocked } };
  fs.writeFileSync(OUT, JSON.stringify(artifact));
  console.error(`\nwrote ${mipEvents.length} mip events into ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1e3).toFixed(0)} KB)`);
}
