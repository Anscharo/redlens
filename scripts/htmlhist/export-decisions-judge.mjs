// Judge-ready export of the threading decisions (plan §10.4): one self-contained JSONL
// record per decision — the decision made, the FULL content of both sides (newer subject
// + chosen older predecessor), and the alternative candidates it was chosen against
// (title/section/score, content truncated) — so an AI (or human) can ingest a record and
// judge the call with zero external context. Read-only; writes .cache/ only.
//
//   bun scripts/htmlhist/export-decisions-judge.mjs                 # all 2989 → .cache/decisions-judge.jsonl
//   bun scripts/htmlhist/export-decisions-judge.mjs --sha 22cc27b5  # one commit's decisions
//   bun scripts/htmlhist/export-decisions-judge.mjs --why-only      # just the evidence-trailed subset
//   bun scripts/htmlhist/export-decisions-judge.mjs --sample 50     # every Nth decision (deterministic thinning)
//
// Record shape:
//   { caseKey, method, agreedWithAuto, why?,
//     transition: { newerSha, newerPr?, olderSha },          // which commit boundary
//     decision: "chose" | "none (born here / split copy)",
//     subject:  { title, section, occurrence?, content },     // the NEWER doc, full text
//     chosen:   { key, title, section, occurrence?, content } | null,  // full text
//     alternatives: [{ key, title, section, score, content┄240 }] }    // what it was chosen against

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const arg = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(ROOT, arg("--out") || ".cache/decisions-judge.jsonl");
const SHA = arg("--sha");
const WHY_ONLY = process.argv.includes("--why-only");
const SAMPLE = arg("--sample") ? Math.max(1, Number(arg("--sample"))) : 1;
const ALT_CAP = 12;

const q = JSON.parse(fs.readFileSync(path.join(ROOT, "public/history-curation.json"), "utf8"));
const file = JSON.parse(fs.readFileSync(path.join(ROOT, "public/history-decisions.json"), "utf8"));
const caseBy = new Map((q.cases || []).map((c) => [c.key, c]));
const prBySha = new Map((q.commits || []).map((c) => [c.sha, c.pr]));
const AGENTS = ["Spark", "Grove", "Keel", "Launch Agent 1", "Launch Agent 2", "Launch Agent 3", "Launch Agent 4"];
const sectionOf = (n) => ((n?.ancestors) || []).find((a) => AGENTS.includes(a)) || (n?.ancestors || [])[0] || n?.section || n?.parentTitle || null;
const occOf = (k) => (k && k.includes("#") ? Number(k.split("#")[1]) : undefined);
const docOf = (k) => {
  const n = q.nodes[k];
  if (!n) return null;
  return { key: k, title: n.title, section: sectionOf(n), occurrence: occOf(k), content: n.content ?? "" };
};

const out = fs.createWriteStream(OUT);
let written = 0, legacy = 0, i = 0;
for (const d of file.decisions || []) {
  if (SHA && d.newerSha !== SHA) continue;
  if (WHY_ONLY && !d.why) continue;
  if (i++ % SAMPLE !== 0) continue;
  const c = caseBy.get(d.caseKey);
  const subjN = q.nodes[d.subjectKey];
  const chosen = d.chosenKey === "none" ? null : docOf(d.chosenKey);
  if (d.chosenKey !== "none" && !chosen) legacy++; // stale legacy key — still export what we have
  const alternatives = (c?.candidates || [])
    .filter((x) => x.key !== d.chosenKey)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, ALT_CAP)
    .map((x) => {
      const n = q.nodes[x.key];
      return { key: x.key, title: n?.title ?? null, section: sectionOf(n), score: x.score ?? null, content: (n?.content ?? "").slice(0, 240) };
    });
  const rec = {
    caseKey: d.caseKey,
    method: d.method,
    agreedWithAuto: d.agreedWithAuto ?? undefined,
    why: d.why ?? undefined,
    transition: { newerSha: d.newerSha, newerPr: prBySha.get(d.newerSha) ?? undefined, olderSha: d.olderSha },
    decision: d.chosenKey === "none" ? "none (born here / split copy)" : "chose",
    subject: subjN ? { title: subjN.title, section: sectionOf(subjN), occurrence: occOf(d.subjectKey), content: subjN.content ?? "" } : { key: d.subjectKey },
    chosen: chosen ?? (d.chosenKey === "none" ? null : { key: d.chosenKey, note: "legacy key not in current queue" }),
    alternatives,
  };
  out.write(JSON.stringify(rec) + "\n");
  written++;
}
out.end(() => {
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.error(`wrote ${path.relative(ROOT, OUT)}  (${written} records, ${kb} KB${legacy ? `, ${legacy} legacy-key chosen sides unresolvable` : ""})`);
  console.error(`judge prompt seed: "For each JSONL record: the 'subject' doc (newer) was decided to descend from the 'chosen' doc (older) — or from nothing if decision=none. Given subject.content, chosen.content and the alternatives, is the decision correct? Answer per caseKey: AGREE / DISAGREE(better key) / UNSURE, with one sentence."`);
});
