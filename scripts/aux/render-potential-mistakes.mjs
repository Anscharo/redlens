// Renders ATLAS-FINDINGS.md from public/potential-mistakes.json — the JSON is
// the single source of truth (it also backs the /reports/potential-mistakes
// page); this markdown is a derived, human-readable export.
//
// The output is gitignored and generated on demand (`pnpm mistakes:render`),
// like every other derived artifact in this repo. Committing it would leave a
// second copy of the findings that goes stale as soon as the JSON is edited
// without a re-render.
//
// Every Issue/Suggested line carries its doc_no INLINE, not just in the heading
// above it: each line is a concrete claim about a specific Atlas document, and
// the citation dictate requires the reference to be reachable from the claim
// itself (a heading two lines up does not satisfy it). `pnpm cite:check` is the
// gate that enforces this.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(ROOT, "public/potential-mistakes.json");
const OUT = path.join(ROOT, "ATLAS-FINDINGS.md");
const data = JSON.parse(fs.readFileSync(SRC, "utf8"));

const CATEGORY_LABELS = {
  numeric: "Numeric / formula", entity: "Wrong entity or address", governance: "Governance logic",
  contradiction: "Contradiction", structural: "Structural", xref: "Broken cross-reference",
  stale: "Stale / dated", placeholder: "Unfilled placeholder", "copy-paste": "Copy-paste residue",
  "wrong-word": "Wrong word", typo: "Typo / spelling", grammar: "Grammar",
  markdown: "Broken markdown", naming: "Naming inconsistency", duplication: "Duplication",
};
const ORDER = Object.keys(CATEGORY_LABELS);
const PASS_LABELS = { language: "Language", factual: "Factual", deterministic: "Mechanical" };

const groups = {};
for (const f of data.findings) (groups[f.category] ??= []).push(f);
const keys = [...new Set([...ORDER.filter((k) => groups[k]), ...Object.keys(groups)])];
const n = (s) => data.findings.filter((f) => f.severity === s).length;

// The citation each claim line carries. A doc_no alone is a valid in-context
// reference per the dictate; the UUID line under the heading is the stable id.
const cite = (f) => `(${f.docNo})`;

let md = `# Sky Atlas — Potential Mistakes\n\n`;
md += `> **LLM-generated, hand-run.** These findings come from an automated language and\n`;
md += `> consistency sweep of the Atlas source text. Each one is a *suspicion*, not a confirmed\n`;
md += `> defect — read the quoted text against the linked document before acting on it.\n>\n`;
md += `> The sweep is **re-run manually** and does **not** re-run when the Atlas updates, so these\n`;
md += `> rows describe the Atlas at commit \`${data.atlasSha.slice(0, 8)}\` (${data.generatedAt}),\n`;
md += `> ${data.documentsScanned.toLocaleString()} documents. Findings already fixed upstream stay\n`;
md += `> listed until the next manual run.\n>\n`;
md += `> Generated from \`public/potential-mistakes.json\`, which also backs the live\n`;
md += `> [Potential Mistakes report](/reports/potential-mistakes) — edit the JSON, not this file.\n\n`;
md += `**${data.findings.length} findings** — ${n("high")} high confidence, ${n("medium")} medium, ${n("low")} low.\n\n`;
md += `| Category | Findings |\n|---|---|\n`;
for (const k of keys) md += `| ${CATEGORY_LABELS[k] ?? k} | ${groups[k].length} |\n`;
md += `\n---\n`;

for (const k of keys) {
  md += `\n## ${CATEGORY_LABELS[k] ?? k} (${groups[k].length})\n\n`;
  for (const f of groups[k]) {
    md += `### \`${f.docNo}\` — ${f.severity}\n`;
    md += `${f.file}${f.uuid ? ` · \`${f.uuid}\`` : " · corpus-wide"} · found by: ${PASS_LABELS[f.pass]}\n\n`;
    if (f.quote) md += `> ${f.quote}\n\n`;
    md += `**Issue** ${cite(f)}**.** ${f.issue}\n\n`;
    md += f.fix
      ? `**Suggested** ${cite(f)}**.** ${f.fix}\n\n`
      : `**Suggested** ${cite(f)}**.** Needs an author decision.\n\n`;
  }
}
fs.writeFileSync(OUT, md);
console.log("wrote", OUT, md.length, "bytes;", data.findings.length, "findings,", keys.length, "categories");
