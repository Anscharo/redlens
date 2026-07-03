// Human-readable render of public/history-decisions.json (plan §10.4). The decisions file
// is content-addressed (caseKey/chosenKey = `${sha8}:${md5|uuid}[#occ]`) and unreadable on
// its own; this joins it against the curation queue and emits a reviewable markdown file:
// per-commit groups, subject title + agent section, chosen predecessor title + section,
// method (deterministic/ai/human), and the recorded `why` evidence where present.
// Read-only; writes .cache/ only (review doc, never artifact data).
//
//   bun scripts/htmlhist/render-decisions.mjs [--out .cache/decisions-review.md] [--why-only]

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const arg = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(ROOT, arg("--out") || ".cache/decisions-review.md");
const WHY_ONLY = process.argv.includes("--why-only");

const q = JSON.parse(fs.readFileSync(path.join(ROOT, "public/history-curation.json"), "utf8"));
const file = JSON.parse(fs.readFileSync(path.join(ROOT, "public/history-decisions.json"), "utf8"));
const commits = new Map((q.commits || []).map((c) => [c.sha, c]));
const AGENTS = ["Spark", "Grove", "Keel", "Launch Agent 1", "Launch Agent 2", "Launch Agent 3", "Launch Agent 4"];
const nodeOf = (k) => q.nodes[k] || null;
const agentOf = (n) => ((n?.ancestors) || []).find((a) => AGENTS.includes(a)) || n?.parentTitle || n?.section || null;
const label = (k) => {
  if (!k || k === "none") return "**none** (born here / split copy)";
  const n = nodeOf(k);
  if (!n) return `\`${k}\` *(key not in current queue — legacy)*`;
  const ag = agentOf(n);
  const occ = k.includes("#") ? ` ·occ#${k.split("#")[1]}` : "";
  return `"${n.title}"${ag ? ` [${ag}]` : ""}${occ}`;
};

const decisions = (file.decisions || []).filter((d) => !WHY_ONLY || d.why);
const bySha = new Map();
for (const d of decisions) (bySha.get(d.newerSha) || bySha.set(d.newerSha, []).get(d.newerSha)).push(d);

const md = [];
md.push(`# HTML-era threading decisions — human-readable render`);
md.push("");
md.push(`Rendered from \`public/history-decisions.json\` (${file.count} decisions) joined against the`);
md.push(`curation queue. Each entry answers: *this newer doc's previous version is which older doc?*`);
md.push(`Methods: deterministic (two independent free signals agreed) · ai (LLM-corroborated or`);
md.push(`Claude-curated, evidence in the why line) · human (curation UI). Browse interactively at`);
md.push(`\`/reports/history-curate\`; audit trail in \`.cache/audit-html-disagreements.md\`.`);
md.push("");
const tally = decisions.reduce((m, d) => ((m[d.method] = (m[d.method] || 0) + 1), m), {});
md.push(`Counts: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(" · ")} · none/split ${decisions.filter((d) => d.chosenKey === "none").length} · with evidence ${decisions.filter((d) => d.why).length}`);
md.push("");

const order = [...bySha.keys()].sort((a, b) => (bySha.get(b).length - bySha.get(a).length));
for (const sha of order) {
  const list = bySha.get(sha);
  const c = commits.get(sha);
  const title = sha === (q.meta?.migrationSha || "22cc27b5") ? "#117 markdown migration (the HTML→md seed boundary)" : c?.prTitle || "?";
  md.push(`## ${sha} — ${title}${c?.pr ? ` (PR #${c.pr})` : ""}${c?.date ? ` · ${c.date.slice(0, 10)}` : ""} · ${list.length} decisions`);
  md.push("");
  for (const d of list) {
    const s = nodeOf(d.subjectKey);
    const sAg = agentOf(s);
    md.push(`- **"${s?.title || d.subjectKey}"**${sAg ? ` [${sAg}]` : ""} ← ${label(d.chosenKey)}  _(${d.method}${d.agreedWithAuto ? ", =matcher" : ""})_`);
    if (d.why) md.push(`  - why: ${d.why}`);
  }
  md.push("");
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md.join("\n"));
console.error(`wrote ${path.relative(ROOT, OUT)}  (${decisions.length} decisions${WHY_ONLY ? ", why-only" : ""})`);
