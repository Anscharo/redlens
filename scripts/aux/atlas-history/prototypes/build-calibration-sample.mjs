// Gate 4: build a stratified, deterministic calibration sample for MIP attribution.
// Bands over mipScore + a title-hit-only stratum; every k-th record per band (no RNG).
import fs from "node:fs";
import { parseHtmlToNodes } from "/Users/m7/lens/scripts/htmlhist/atlas-html.mjs";

const SCRATCH = "/private/tmp/claude-502/-Users-m7-lens/6d7b89bd-66ed-458f-82e7-01cccffb710e/scratchpad";
const REC = "/Users/m7/lens/scripts/aux/atlas-history/recovered";
const recs = JSON.parse(fs.readFileSync(`${REC}/mip-genesis-lineage.json`, "utf8"));
const corpus = JSON.parse(fs.readFileSync(`${REC}/mip-corpus.json`, "utf8"));
const genesis = parseHtmlToNodes(fs.readFileSync(`${REC}/genesis-2024-09-02.html`, "utf8"));
const gByOrder = new Map(genesis.map((g) => [g.order, g]));

const secByKey = new Map();
for (const s of corpus) secByKey.set(`${s.mip}|${s.sec ?? ""}|${s.title ?? ""}`, s);

const BANDS = [
  { name: "0.05-0.15", f: (r) => r.mipScore >= 0.05 && r.mipScore < 0.15, n: 8 },
  { name: "0.15-0.25", f: (r) => r.mipScore >= 0.15 && r.mipScore < 0.25, n: 8 },
  { name: "0.25-0.40", f: (r) => r.mipScore >= 0.25 && r.mipScore < 0.4, n: 10 },
  { name: "0.40-0.60", f: (r) => r.mipScore >= 0.4 && r.mipScore < 0.6, n: 10 },
  { name: "0.60-1.00", f: (r) => r.mipScore >= 0.6, n: 10 },
  { name: "titlehit-only", f: (r) => r.mipScore < 0.25 && r.titleHitMip && r.shingleCount >= 4, n: 8 },
];

const eligible = recs.filter((r) => r.shingleCount >= 4 && r.mip);
const sample = [];
for (const b of BANDS) {
  const pool = eligible.filter(b.f);
  const step = Math.max(1, Math.floor(pool.length / b.n));
  const take = [];
  for (let i = 0; i < pool.length && take.length < b.n; i += step) take.push(pool[i]);
  console.log(`${b.name}: pool=${pool.length} sampled=${take.length}`);
  for (const r of take) {
    const g = gByOrder.get(r.order);
    const sec = secByKey.get(`${r.mip}|${r.mipSec ?? ""}|${r.mipSecTitle ?? ""}`) ||
      corpus.find((s) => s.mip === r.mip && s.sec === r.mipSec) ||
      corpus.find((s) => s.mip === r.mip && s.title === r.mipSecTitle);
    sample.push({
      band: b.name,
      gOrder: r.order, gDocNo: r.docNo, gTitle: r.title, gSection: r.section,
      mip: r.mip, mipSec: r.mipSec, mipSecTitle: r.mipSecTitle,
      mipScore: r.mipScore, mipSecScore: r.mipSecScore, titleHitMip: r.titleHitMip,
      genesisContent: (g?.content || "").slice(0, 700),
      mipSectionContent: (sec?.content || "(section not found)").slice(0, 700),
    });
  }
}
fs.writeFileSync(`${SCRATCH}/calibration-sample.json`, JSON.stringify(sample, null, 1));

// human/model-readable review sheet
let md = "# MIP attribution calibration sample\n";
for (const [i, s] of sample.entries()) {
  md += `\n---\n## #${i} [${s.band}] score=${s.mipScore} secScore=${s.mipSecScore}${s.titleHitMip ? ` titleHit=MIP${s.titleHitMip}` : ""}\n`;
  md += `**GENESIS** ${s.gDocNo ?? "?"} — ${s.gTitle} (${s.gSection})\n\n> ${s.genesisContent.replace(/\n/g, "\n> ")}\n\n`;
  md += `**MIP${s.mip} §${s.mipSec ?? "?"} — ${s.mipSecTitle ?? "(no title)"}**\n\n> ${s.mipSectionContent.replace(/\n/g, "\n> ")}\n`;
}
fs.writeFileSync(`${SCRATCH}/calibration-sample.md`, md);
console.log(`total sampled: ${sample.length}; wrote calibration-sample.{json,md}`);
