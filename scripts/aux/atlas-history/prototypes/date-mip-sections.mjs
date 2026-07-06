// For every MIP section matched by an alive genesis doc (score>=0.25), find the
// first mips-repo commit whose diff introduces the section title -> date.
// Output: mip-section-dates.json { "mip:sec": { date, sha, title } }
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const SCRATCH = "/private/tmp/claude-502/-Users-m7-lens/6d7b89bd-66ed-458f-82e7-01cccffb710e/scratchpad";
const MIPS = `${SCRATCH}/mips`;
const recs = JSON.parse(fs.readFileSync(`${SCRATCH}/mip-genesis-lineage.json`, "utf8"));

const wanted = new Map();
for (const r of recs) {
  if (r.mipScore >= 0.25 && r.mip && r.mipSecTitle) {
    wanted.set(`${r.mip}:${r.mipSec || r.mipSecTitle}`, { mip: r.mip, sec: r.mipSec, title: r.mipSecTitle });
  }
}
console.log("distinct MIP sections to date:", wanted.size);

const out = {};
let i = 0;
for (const [key, w] of wanted) {
  i++;
  try {
    const res = execFileSync(
      "git",
      ["log", "--all", "--reverse", "--format=%ad %h", "--date=short", `-S${w.title}`, "--", `MIP${w.mip}/MIP${w.mip}.md`],
      { cwd: MIPS, encoding: "utf8", timeout: 30000 }
    ).trim().split("\n")[0];
    if (res) {
      const [date, sha] = res.split(" ");
      out[key] = { date, sha, title: w.title };
    }
  } catch { /* section title unfindable; falls back to MIP ratification date */ }
  if (i % 25 === 0) console.log(`${i}/${wanted.size}`);
}
fs.writeFileSync(`${SCRATCH}/mip-section-dates.json`, JSON.stringify(out, null, 1));
const dates = Object.values(out).map((o) => o.date).sort();
console.log("dated:", Object.keys(out).length, "range:", dates[0], "→", dates[dates.length - 1]);
const byYear = {};
for (const d of dates) byYear[d.slice(0, 7)] = (byYear[d.slice(0, 7)] || 0) + 1;
console.log("by month:", JSON.stringify(byYear));
