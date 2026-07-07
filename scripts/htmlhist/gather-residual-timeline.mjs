// Temporal enrichment for the HARDEST residual of the HTML-era curation queue (plan
// §10.4 timeline enrichment). The content/position/diff signals the propose prompt
// already sees don't say WHEN anything happened; this fills in, per residual case:
//   - each candidate's INTRODUCED + LAST HTML EDIT commit (+ that commit's already-
//     fetched PR/forum text — no new network fetch, just a join against the queue's
//     per-commit metadata)
//   - for a seed-close case (the newer doc IS the final #117 markdown doc), its
//     POST-MIGRATION edit history from the modern atlas_history table: still being
//     edited under a stable topic is corroborating; deleted soon after is a red flag.
//
// Scoped to the RESIDUAL by default (cases neither auto-decided nor human-decided) —
// gathering this for the whole queue is unnecessary; it's the ~60-ish hard tail that
// needs it. Reloads the HTML commits (same slow turndown as the other aux scripts —
// no shared cache exists yet, matching auto-curate-html-history.mjs / forward-trace-
// html-history.mjs).
//
//   bun scripts/htmlhist/gather-residual-timeline.mjs                # residual only
//   bun scripts/htmlhist/gather-residual-timeline.mjs --all          # every case in the queue
//   bun scripts/htmlhist/gather-residual-timeline.mjs --no-db        # skip the post-migration DB read
//   bun scripts/htmlhist/gather-residual-timeline.mjs --limit 25     # cap cases (trial run)
//
// Output: public/history-curation-timeline.json — a sidecar the curation UI / a new
// propose-with-timeline prompt can join by caseKey without recomputing any of this.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { loadHtmlAt } from "./atlas-html.mjs";
import { buildTimelineIndex, timelineFor, commitInfoIndex, enrichTimeline } from "./history-timeline.mjs";

const ROOT = process.cwd();
const REPO = path.join(ROOT, "vendor/next-gen-atlas");
const CURATION = path.join(ROOT, "public/history-curation.json");
const AUTO_DECISIONS = path.join(ROOT, "public/history-auto-decisions.json");
const HUMAN_DECISIONS = path.join(ROOT, "public/history-decisions.json");
const arg = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(ROOT, arg("--out") || "public/history-curation-timeline.json");
const ALL = process.argv.includes("--all");
const NO_DB = process.argv.includes("--no-db");
const LIMIT = arg("--limit") ? Number(arg("--limit")) : Infinity;
const LAST_HTML_SHA_DEFAULT = "7b43d159";
const HTML = "Sky Atlas/Sky Atlas.html";

const git = (a) => execSync(`git -C "${REPO}" ${a}`, { maxBuffer: 1 << 30 }).toString();
const t0 = Date.now();
const log = (m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

if (!fs.existsSync(CURATION)) {
  console.error(`curation queue not found: ${path.relative(ROOT, CURATION)}\n  run: pnpm htmlhist:curate`);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(CURATION, "utf8"));
log(`curation queue: ${(data.cases || []).length} cases`);

// residual = cases with no recorded decision yet, in EITHER the auto baseline or the
// committed human file — the same notion of "still needs a look" the curation UI uses.
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
  log(`residual (not yet decided): ${cases.length} cases`);
} else {
  log(`--all: gathering timeline for every case (${cases.length})`);
}
if (Number.isFinite(LIMIT)) cases = cases.slice(0, LIMIT);

log("loading HTML commits for identity lineage (turndown per row — slow)…");
const lastHtmlSha = data.meta?.lastHtmlSha || LAST_HTML_SHA_DEFAULT;
const shas = git(`log --reverse --format=%H ${lastHtmlSha} -- '${HTML}'`).trim().split("\n");
const commits = shas.map((full, i) => {
  if (i % 20 === 0) log(`  …converting ${i}/${shas.length}`);
  return { sha: full.slice(0, 8), nodes: loadHtmlAt(full, REPO) };
});
log(`loaded ${commits.length} commits`);

const timelineIndex = buildTimelineIndex(commits);
const commitInfo = commitInfoIndex(data.commits);
const timelineByKey = (key) => enrichTimeline(timelineFor(timelineIndex, key), commitInfo);

const out = { cases: {} };
const seedCloseUuidByCase = new Map(); // caseKey -> uuid, for the batched DB read below
for (const kase of cases) {
  const candidates = {};
  for (const cand of kase.candidates || []) {
    const t = timelineByKey(cand.key);
    if (t) candidates[cand.key] = t;
  }
  const entry = { candidates };
  if (kase.kind === "seed-close") {
    const uuid = kase.subjectKey.slice(kase.subjectKey.indexOf(":") + 1);
    seedCloseUuidByCase.set(kase.key, uuid);
  } else {
    const t = timelineByKey(kase.subjectKey);
    if (t) entry.subject = t;
  }
  out.cases[kase.key] = entry;
}
log(`candidate/subject HTML timelines: ${Object.keys(out.cases).length} cases`);

if (!NO_DB && seedCloseUuidByCase.size) {
  log(`fetching post-migration history for ${seedCloseUuidByCase.size} seed-close subjects…`);
  const { sql, waitForDb } = await import("../../src/server/db.ts");
  const { gitCommitSeq } = await import("../../src/server/history-db.ts");
  const { fetchPostMigrationHistory } = await import("../../src/server/history-timeline-db.ts");
  await waitForDb();
  const seqByCommit = gitCommitSeq();
  const migrationSha7 = (data.meta?.migrationSha || "").slice(0, 7);
  const sinceSeq = seqByCommit.get(migrationSha7);
  if (sinceSeq == null) {
    log(`  migration commit ${migrationSha7} not found by gitCommitSeq() — skipping post-migration history`);
  } else {
    const uuids = [...new Set(seedCloseUuidByCase.values())];
    const postByUuid = await fetchPostMigrationHistory(sql, uuids, sinceSeq);
    for (const [caseKey, uuid] of seedCloseUuidByCase) {
      const p = postByUuid.get(uuid);
      if (p) out.cases[caseKey].postMigration = p;
    }
    log(`  post-migration history: ${postByUuid.size}/${uuids.length} subjects had post-migration rows`);
  }
  await sql.end();
} else if (seedCloseUuidByCase.size) {
  log(`--no-db: skipping post-migration history for ${seedCloseUuidByCase.size} seed-close subjects`);
}

const file = {
  kind: "html-era-curation-timeline",
  builtFrom: { migrationSha: data.meta?.migrationSha, lastHtmlSha: data.meta?.lastHtmlSha },
  scope: ALL ? "all" : "residual",
  count: Object.keys(out.cases).length,
  cases: out.cases,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(file, null, 2));
log(`wrote ${path.relative(ROOT, OUT)}  (${file.count} cases)`);
