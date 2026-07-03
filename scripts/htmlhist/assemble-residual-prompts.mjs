// Assembles a ready-to-paste PROMPT BATCH for the hardest residual HTML-era curation
// cases — no LLM call, no pipeline wiring. Joins:
//   - the curation queue (public/history-curation.json): case/candidate/subject content
//   - the timeline sidecar (public/history-curation-timeline.json, from
//     gather-residual-timeline.mjs): candidate INTRODUCED/LAST HTML EDIT + subject
//     POST-MIGRATION history
// into the final-escalation prompt (scripts/htmlhist/curate-prompt-expanded.mjs) for each
// residual case, and writes one system/user pair per case — hand the batch to
// whatever agent/tool you like (this script makes no API calls of its own).
//
//   bun scripts/htmlhist/assemble-residual-prompts.mjs
//   bun scripts/htmlhist/assemble-residual-prompts.mjs --all       # every case, not just residual
//   bun scripts/htmlhist/assemble-residual-prompts.mjs --limit 5   # cap (trial run)
//
// Output: .cache/residual-prompts.json (structured, one entry per case) +
//         .cache/residual-prompts.md   (human-readable, for literal copy-paste)

import fs from "node:fs";
import path from "node:path";
import { buildClaimIndex, enrichSubject, enrichCandidates } from "./curate-context.mjs";
import { SYSTEM_EXPANDED, buildExpandedUser } from "./curate-prompt-expanded.mjs";

const ROOT = process.cwd();
const CURATION = path.join(ROOT, "public/history-curation.json");
const TIMELINE = path.join(ROOT, "public/history-curation-timeline.json");
const AUTO_DECISIONS = path.join(ROOT, "public/history-auto-decisions.json");
const HUMAN_DECISIONS = path.join(ROOT, "public/history-decisions.json");
const arg = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
const OUT_JSON = path.resolve(ROOT, arg("--out") || ".cache/residual-prompts.json");
const OUT_MD = OUT_JSON.replace(/\.json$/, ".md");
const ALL = process.argv.includes("--all");
const LIMIT = arg("--limit") ? Number(arg("--limit")) : Infinity;

if (!fs.existsSync(CURATION)) {
  console.error(`curation queue not found: ${path.relative(ROOT, CURATION)}\n  run: pnpm htmlhist:curate`);
  process.exit(1);
}
if (!fs.existsSync(TIMELINE)) {
  console.error(`timeline sidecar not found: ${path.relative(ROOT, TIMELINE)}\n  run: bun scripts/htmlhist/gather-residual-timeline.mjs`);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(CURATION, "utf8"));
const timeline = JSON.parse(fs.readFileSync(TIMELINE, "utf8"));

function decidedKeys(file) {
  if (!fs.existsSync(file)) return new Set();
  try {
    const f = JSON.parse(fs.readFileSync(file, "utf8"));
    return new Set((f.decisions || []).map((d) => d.caseKey));
  } catch {
    return new Set();
  }
}
let cases = data.cases || [];
if (!ALL) {
  const decided = new Set([...decidedKeys(AUTO_DECISIONS), ...decidedKeys(HUMAN_DECISIONS)]);
  cases = cases.filter((c) => !decided.has(c.key));
}
if (Number.isFinite(LIMIT)) cases = cases.slice(0, LIMIT);

const claimIndex = buildClaimIndex(data.cases || []); // sole-home computed over the WHOLE queue, not just residual
const changeBySha = new Map();
for (const c of data.commits || []) if (c.prTitle || c.changeSummary) changeBySha.set(c.sha, { pr: c.pr, title: c.prTitle, summary: c.changeSummary });

const missingTimeline = [];
const prompts = [];
for (const kase of cases) {
  const subject = enrichSubject(kase.subjectKey, data.nodes);
  const candidates = enrichCandidates(kase, data.nodes, claimIndex);
  if (!subject || !candidates.length) continue;
  const t = timeline.cases?.[kase.key];
  if (!t) missingTimeline.push(kase.key);
  // fold timeline data onto the enriched shapes buildExpandedUser expects
  const candidatesWithTimeline = candidates.map((c) => (t?.candidates?.[c.key] ? { ...c, timeline: t.candidates[c.key] } : c));
  const subjectWithTimeline = t?.subject ? { ...subject, timeline: t.subject } : t?.postMigration ? { ...subject, postMigration: t.postMigration } : subject;
  const user = buildExpandedUser(subjectWithTimeline, candidatesWithTimeline, { change: changeBySha.get(kase.newerSha) });
  prompts.push({
    caseKey: kase.key, kind: kase.kind, subjectTitle: subject.title,
    candidateKeys: candidates.map((c) => c.key),
    system: SYSTEM_EXPANDED, user,
  });
}

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify({ kind: "html-era-residual-prompts", scope: ALL ? "all" : "residual", count: prompts.length, prompts }, null, 2));

const md = prompts.map((p, i) =>
  `## ${i + 1}. ${p.subjectTitle} (\`${p.caseKey}\`, ${p.kind})\n\n` +
  `### System\n\`\`\`\n${p.system}\n\`\`\`\n\n` +
  `### User\n\`\`\`\n${p.user}\n\`\`\`\n`,
).join("\n---\n\n");
fs.writeFileSync(OUT_MD, `# HTML-era curation — residual prompt batch (${prompts.length} cases)\n\n${md}`);

console.error(`wrote ${path.relative(ROOT, OUT_JSON)} + ${path.relative(ROOT, OUT_MD)}  (${prompts.length} cases)`);
if (missingTimeline.length) console.error(`note: ${missingTimeline.length} case(s) had no timeline data (gather-residual-timeline.mjs didn't cover them) — prompt built without INTRODUCED/LAST HTML EDIT/POST-MIGRATION context for those.`);
