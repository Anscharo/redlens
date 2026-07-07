// Fetch raw markdown of the severed-window Atlas Edit proposals (29 cycles).
import fs from "node:fs";
import path from "node:path";

const SCRATCH = "/private/tmp/claude-502/-Users-m7-lens/6d7b89bd-66ed-458f-82e7-01cccffb710e/scratchpad";
const OUT_DIR = path.join(SCRATCH, "forum-severed");
fs.mkdirSync(OUT_DIR, { recursive: true });

const manifest = JSON.parse(
  fs.readFileSync("/Users/m7/lens/scripts/aux/atlas-history/atlas-edit-proposals.json", "utf8")
);
const severed = manifest.proposals.filter((p) => p.window === "severed" && p.is_cycle_proposal);
console.log("severed cycle proposals:", severed.length);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, fail = 0;
for (const p of severed) {
  const file = path.join(OUT_DIR, `${p.id}.md`);
  if (fs.existsSync(file) && fs.statSync(file).size > 200) { ok++; continue; }
  try {
    const res = await fetch(p.raw_url, { headers: { "User-Agent": "redline-atlas-research/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    fs.writeFileSync(file, text);
    console.log(`${p.id} ${p.date} ${text.length}b — ${p.title.slice(0, 60)}`);
    ok++;
    await sleep(1200);
  } catch (e) {
    console.error(`FAIL ${p.id}: ${e.message}`);
    fail++;
    await sleep(3000);
  }
}
console.log(`done: ${ok} ok, ${fail} failed`);
