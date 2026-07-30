// Cross-agent claim sweep over the seed decisions (post-curation guard). The 2026-07-03
// decision audit found 50 seed decisions (2.3% of agent-scope) whose subject sat in one
// agent's section while the chosen 7b43d159 occurrence sat in ANOTHER agent's — bulk-
// curation rotation cycles over identical per-primitive boilerplate stubs. At the #117
// seam the five agents exist on both sides, so a cross-agent claim is a fabricated
// lineage by definition. Re-run this after any future curation round; expect 0.
//
// Subject agent comes from the #117 markdown doc_no (A.6.1.1.<n> ⇒ n=1..5 =
// Spark/Grove/Keel/Launch Agent 3/Launch Agent 4 — verified pure against parentTitle);
// occurrence agent from the queue node's HTML ancestors. Read-only; exits 1 on findings.
//
//   bun scripts/htmlhist/check-cross-agent.mjs [--decisions FILE]

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { loadHtmlAt } from "./atlas-html.mjs";
import { contentDupCounts, occKey } from "./history-occkey.mjs";

const ROOT = process.cwd();
const REPO = path.join(ROOT, "vendor/next-gen-atlas");
const arg = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
const DECISIONS = path.resolve(ROOT, arg("--decisions") || "public/history-decisions.json");
const MD117 = "22cc27b5", SEED_HTML = "7b43d159";
const AGENT_BY_PREFIX = { 1: "Spark", 2: "Grove", 3: "Keel", 4: "Launch Agent 3", 5: "Launch Agent 4" };
const AGENTS = Object.values(AGENT_BY_PREFIX);

const md = execSync(`git -C "${REPO}" show '${MD117}:Sky Atlas/Sky Atlas.md'`, { maxBuffer: 1 << 30 }).toString();
const HEADING_RE = /^#{1,6} ([\w.-]+) - .*?<!-- UUID: ([0-9a-f-]{36}) -->$/gm;
const uuidAgent = new Map();
let m;
while ((m = HEADING_RE.exec(md))) {
  const a = m[1].match(/^A\.6\.1\.1\.(\d)(\.|$)/); // structural agent-scope prefix at the #117 snapshot
  uuidAgent.set(m[2], a ? AGENT_BY_PREFIX[a[1]] : null);
}

const q = JSON.parse(fs.readFileSync(path.join(ROOT, "public/history-curation.json"), "utf8"));
const decisions = JSON.parse(fs.readFileSync(DECISIONS, "utf8")).decisions || [];

// Occurrence agent comes from the curation queue when the key is in it. Decisions minted
// OUTSIDE the queue — `pnpm htmlhist:structural` proposes forced pairs the queue never
// raised a case for — would otherwise be silently skipped here, so fall back to reading
// the row straight out of the last HTML commit. Same keys (history-occkey), so the two
// sources agree wherever they overlap; this only ADDS coverage.
const rowByKey = new Map();
{
  const rows = loadHtmlAt(SEED_HTML, REPO);
  const dup = contentDupCounts(rows);
  for (const r of rows) rowByKey.set(occKey(SEED_HTML, r, dup), r);
}
const agentOfOcc = (k) => {
  const fromQueue = (q.nodes[k]?.ancestors || []).find((a) => AGENTS.includes(a));
  if (fromQueue) return fromQueue;
  const row = rowByKey.get(k);
  if (!row) return null;
  return [row.owner, ...(row.ancestors || [])].find((a) => AGENTS.includes(a)) || null;
};

let checked = 0;
const findings = [];
for (const d of decisions) {
  if (d.newerSha !== MD117 || !d.chosenKey || d.chosenKey === "none") continue;
  const subjAgent = uuidAgent.get(String(d.subjectKey).split(":")[1]);
  if (!subjAgent) continue; // subject not in the agent scope
  const occAgent = agentOfOcc(d.chosenKey);
  if (!occAgent) continue; // chosen occurrence not in an agent section
  checked++;
  if (occAgent !== subjAgent) {
    findings.push(d);
    console.log(`CROSS-AGENT ${d.caseKey}  [${d.method}] "${(q.nodes[d.subjectKey]?.title || "").slice(0, 44)}"  ${subjAgent} -> ${occAgent}`);
  }
}
console.log(`\nagent-scope seed decisions checked: ${checked}  ·  cross-agent claims: ${findings.length}`);
process.exit(findings.length ? 1 : 0);
