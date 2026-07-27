#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// When imported (by the proof test) rather than run as a CLI, skip the lcov
// reading + process.exit main block below — only the exported area helpers load.
const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

const repo = process.cwd();
const lcovPaths = (process.env.COVERAGE_LCOV ?? "coverage/vitest/lcov.info,coverage/bun/lcov.info")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const outJson = process.env.COVERAGE_AREAS_JSON ?? "coverage/coverage-areas.json";
const outMd = process.env.COVERAGE_AREAS_MD ?? "coverage/coverage-summary.md";
const baseRef = process.env.COVERAGE_BASE_REF ?? process.env.GITHUB_BASE_REF ?? "origin/main";
const baselinePath = process.env.COVERAGE_BASELINE_JSON;
const minChanged = Number(process.env.COVERAGE_CHANGED_MIN ?? "85");

// React code (components / hooks / context) is split into per-product meters so
// each product's test coverage is tracked on its own. Ordering is load-bearing:
// areaFor() returns the FIRST area whose pattern matches, so specific product
// buckets are listed before the broad `react-general` catch-all, and the React
// buckets sit before `general-utils` (whose `^src/lib/` would otherwise swallow
// the lib/*.tsx context providers). The set of React bucket ids below is proved
// to be a total + disjoint partition of the React file set by
// scripts_tests/coverage-areas.test.ts — keep the two in sync.
export const areas = [
  // ---- React product meters ----
  { id: "react-radar", label: "React · Radar", match: [/^src\/components\/radar\//] },
  { id: "react-reports", label: "React · Reports", match: [/^src\/components\/reports\//] },
  { id: "react-reader-history", label: "React · Reader (history)", match: [/^src\/components\/history\//] },
  {
    id: "react-reader-panel",
    label: "React · Reader (panel)",
    // Right-panel views. Listed before reader-tree so tree can claim the rest of atlas/.
    match: [/^src\/components\/atlas\/(RightPanel|AtlasAnnotations|NodeMeta|NodeSelectBox|AtlasActionsContext)\.tsx$/],
  },
  {
    id: "react-reader-tree",
    label: "React · Reader (tree)",
    // The tree sidebar plus everything else under atlas/ — the reader views
    // (AtlasView/AtlasReader/CollapsibleNode/JuniorPane) and their hooks
    // (useDepth6Expand, useAtlasScroll, useExpandAll, and any future atlas hook).
    // Panel files are matched above; this deliberately catches the whole dir so
    // reader hooks don't leak into react-general.
    match: [/^src\/components\/tree\//, /^src\/components\/atlas\//],
  },
  {
    id: "react-reader-content",
    label: "React · Reader (content)",
    match: [/^src\/components\/(NodeContent|NodeContentInner|AddressCard|RelatedNode|RelatedSelectBox|DocNoChiclets|Breadcrumbs|AtlasLink)\.tsx$/],
  },
  {
    id: "react-reader-search",
    label: "React · Reader (search)",
    match: [/^src\/components\/(SearchBar|SearchResults|SearchResult|SearchResultSelectBox|SearchHints|RecentSearches)\.tsx$/],
  },
  { id: "react-chat", label: "React · Chat", match: [/^src\/components\/chat\//] },
  // Collections = the saved-collections feature + its selection-mode UI (they ship together).
  { id: "react-collections", label: "React · Collections", match: [/^src\/components\/(collections|selection)\//] },
  {
    id: "react-general",
    label: "React · General",
    match: [
      /^src\/components\//, // remaining components: preview, constellations, app shell
      /^src\/hooks\//, // all hooks (.ts + .tsx) — cross-cutting, not owned by one product
      /^src\/(App|main)\.tsx$/,
      /^src\/lib\/(dataSource|previewView|previewDiff|selection)\.tsx$/, // context providers
    ],
  },
  // ---- Non-React ----
  { id: "frontend-workers", label: "Front-end workers", match: [/^src\/workers\//] },
  { id: "backend-routes", label: "Backend routes", match: [/^src\/server\/(index|http|sse|auth|mcp|posthog-proxy)\.ts$/, /^src\/server\/preview\/handler\.ts$/] },
  { id: "backend-workers", label: "Backend workers", match: [/^src\/server\/(atlas-updater|atlas-refresh|sync|sync-embeddings|prefetch)\.ts$/, /^src\/server\/preview\/(sweeper|build)\.ts$/, /^scripts\/required\/atlas-worker\.mjs$/] },
  // ---- Backend product meters ----
  // `backend-core` used to be a single ~5k-line catch-all over ALL of src/server/.
  // It's split into per-product meters so each backend product's test coverage is
  // tracked on its own. Ordering is load-bearing (areaFor returns the FIRST match):
  // these sit AFTER backend-routes + backend-workers (so preview/handler.ts stays a
  // route and preview/{build,sweeper}.ts stay workers) and BEFORE the backend-core
  // misc catch-all. The set of backend product ids below is proved to be a total
  // partition of src/server/ by scripts_tests/coverage-areas.test.ts — keep in sync.
  { id: "backend-preview", label: "Backend · PR review (preview)", match: [/^src\/server\/preview\//] },
  {
    id: "backend-history",
    label: "Backend · History",
    match: [/^src\/server\/(history|history-db|history-curate|history-timeline-db|first-seen|freshness|canonical)\.ts$/],
  },
  {
    id: "backend-chat-tools",
    label: "Backend · Chat/AI (tools)",
    // The LLM tool layer the chat agent calls: registry + graph/history tool impls.
    match: [/^src\/server\/(tool-registry|tools|tools-graph|tools-history|llm-tools)\.ts$/],
  },
  {
    id: "backend-chat-verify",
    label: "Backend · Chat/AI (verify)",
    // Answer grounding: verifier(s), verify-checks, citation repair, round checks, advisor.
    match: [/^src\/server\/(verifier|verifier-slices|verify-checks|citation-repair|advisor|round-checks)\.ts$/],
  },
  {
    id: "backend-chat",
    label: "Backend · Chat/AI (core)",
    // Conversation orchestration + LLM plumbing: orchestrator, loop, chat, prompt,
    // model routing, credits/budget. Listed after tools/verify so those claim theirs.
    match: [/^src\/server\/(chat|chat-loop|chat-history|chat-orchestrator|system-prompt|output-budget|credits|llm|model-router)\.ts$/],
  },
  {
    id: "backend-retrieval",
    label: "Backend · Retrieval",
    // RAG/search retrieval: query build, indexes, keyword search, embeddings, entity/doc resolve.
    match: [/^src\/server\/(query|query-schema|indexes|search|embed|embed-text|entity-resolve|entity-kind|doc-rows)\.ts$/],
  },
  { id: "backend-reports", label: "Backend · Reports", match: [/^src\/server\/reports\//] },
  // Misc catch-all — everything else under src/server/ (config, og/og-image, bundle-store,
  // collections, session, rate-limit, migrate, db, posthog-*, atlas-static). Keep last.
  { id: "backend-core", label: "Backend · Core (misc)", match: [/^src\/server\//] },
  { id: "general-utils", label: "General utils/units", match: [/^src\/lib\//, /^scripts\/lib\//] },
];

// Ids of the React product meters, in display order. The proof test asserts every
// React source file (components + hooks + context, .ts/.tsx, minus tests) maps to
// exactly one of these.
export const reactAreaIds = areas.filter((a) => a.id.startsWith("react-")).map((a) => a.id);

// Ids of the backend meters (routes, workers, and the product split of the former
// backend-core), in display order. The proof test asserts every src/server file maps
// to exactly one of these and none leak to general-utils/uncategorized. `backend-core`
// is the misc catch-all, so totality holds automatically for any new src/server file.
export const backendAreaIds = areas.filter((a) => a.id.startsWith("backend-")).map((a) => a.id);

// First match wins. Specific areas precede broad ones in `areas`, so a plain
// ordered scan yields the correct bucket (e.g. backend-routes before backend-core,
// react-reader-* before react-general before general-utils).
export function areaFor(file) {
  const area = areas.find((a) => a.match.some((re) => re.test(file)));
  return area?.id ?? "uncategorized";
}

function pct(covered, total) {
  return total ? (covered / total) * 100 : null;
}

function fmt(value) {
  return value == null ? "n/a" : `${value.toFixed(2)}%`;
}

function fmtDelta(value) {
  if (value == null) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)} pts`;
}

function parseLcov(text) {
  const byFile = new Map();
  let file = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      file = path.relative(repo, line.slice(3)).replaceAll(path.sep, "/");
      byFile.set(file, new Map());
    } else if (file && line.startsWith("DA:")) {
      const [lineNo, hits] = line.slice(3).split(",").map(Number);
      byFile.get(file).set(lineNo, hits);
    } else if (line === "end_of_record") {
      file = null;
    }
  }
  return byFile;
}

function changedLines() {
  try {
    execFileSync("git", ["rev-parse", "--verify", baseRef], { stdio: "ignore" });
  } catch {
    return new Map();
  }
  // Scoped to what the LCOV inputs can actually instrument (vitest's
  // coverage.include is src/**/*.{ts,tsx} + scripts/lib/**/*.mjs; bun's
  // coverage only sees modules src/server tests load). A changed file outside
  // this scope — e.g. a scripts/required/*.mjs build script — would never
  // appear in either LCOV, so the per-file loop below could never count its
  // changed lines and the coverage gate would silently pass it as untested.
  const diff = execFileSync("git", ["diff", "--unified=0", `${baseRef}...HEAD`, "--", "src", "scripts/lib"], { encoding: "utf8" });
  const result = new Map();
  let file = null;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6);
      if (!result.has(file)) result.set(file, new Set());
    } else if (file && line.startsWith("@@")) {
      const match = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (!match) continue;
      const start = Number(match[1]);
      const count = Number(match[2] ?? "1");
      for (let n = start; n < start + count; n += 1) result.get(file).add(n);
    }
  }
  return result;
}

// Coverage should be measured over lines of LOGIC, not total instrumented lines.
// v8 (and bun) instrument purely-structural lines — a lone `}`, `});`, `)`, `],`
// — and a closing brace after an early return is often reported uncovered even
// when the block is fully tested. Excluding these from both the numerator and
// denominator keeps a meter honest: it reflects tested logic, not brace noise.
const srcCache = new Map();
function isLogicLine(file, lineNo) {
  if (!srcCache.has(file)) {
    try {
      srcCache.set(file, readFileSync(path.resolve(repo, file), "utf8").split(/\r?\n/));
    } catch {
      srcCache.set(file, null);
    }
  }
  const lines = srcCache.get(file);
  if (!lines) return true; // unreadable → count it (conservative)
  const t = (lines[lineNo - 1] ?? "").trim();
  if (!t) return false; // blank
  // A logic line carries an identifier, keyword, or literal. A line that is only
  // braces / brackets / parens / semicolons / commas / operators is structural.
  return /[A-Za-z0-9_$"'`]/.test(t);
}

if (isMain) runMain();

function runMain() {
const missingLcov = lcovPaths.filter((lcovPath) => !existsSync(lcovPath));
if (missingLcov.length) {
  console.error(`Missing coverage LCOV file(s): ${missingLcov.join(", ")}. Run coverage before coverage:areas.`);
  process.exit(1);
}

const lcov = new Map();
for (const lcovPath of lcovPaths) {
  for (const [file, lines] of parseLcov(readFileSync(lcovPath, "utf8"))) {
    if (!lcov.has(file)) {
      lcov.set(file, lines);
      continue;
    }
    const existing = lcov.get(file);
    for (const [lineNo, hits] of lines) {
      existing.set(lineNo, (existing.get(lineNo) ?? 0) + hits);
    }
  }
}
const changed = changedLines();
const summary = Object.fromEntries(areas.map((area) => [area.id, { ...area, covered: 0, total: 0, changedCovered: 0, changedTotal: 0 }]));
summary.uncategorized = { id: "uncategorized", label: "Uncategorized", covered: 0, total: 0, changedCovered: 0, changedTotal: 0 };

for (const [file, lines] of lcov) {
  const bucket = summary[areaFor(file)];
  for (const [lineNo, hits] of lines) {
    if (!isLogicLine(file, lineNo)) continue; // skip brace-only / structural lines
    bucket.total += 1;
    if (hits > 0) bucket.covered += 1;
  }
  for (const lineNo of changed.get(file) ?? []) {
    if (!lines.has(lineNo)) continue;
    if (!isLogicLine(file, lineNo)) continue; // measure logic lines, not braces
    bucket.changedTotal += 1;
    if (lines.get(lineNo) > 0) bucket.changedCovered += 1;
  }
}

const rows = Object.values(summary).map(({ id, label, covered, total, changedCovered, changedTotal }) => ({
  id,
  label,
  covered,
  total,
  coverage: pct(covered, total),
  changedCovered,
  changedTotal,
  changedCoverage: pct(changedCovered, changedTotal),
}));
const baselineRows = baselinePath && existsSync(baselinePath)
  ? new Map(JSON.parse(readFileSync(baselinePath, "utf8")).rows.map((row) => [row.id, row]))
  : new Map();
for (const row of rows) {
  const base = baselineRows.get(row.id);
  row.baseCoverage = base?.coverage ?? null;
  row.coverageDelta = row.coverage == null || row.baseCoverage == null ? null : row.coverage - row.baseCoverage;
}
const failed = rows.filter((row) => row.changedTotal > 0 && row.changedCoverage < minChanged);
mkdirSync(path.dirname(outJson), { recursive: true });
writeFileSync(outJson, `${JSON.stringify({ minChanged, baseRef, lcovPaths, rows, failed }, null, 2)}\n`);
writeFileSync(outMd, [
  "### Coverage by area",
  "",
  `Changed-code minimum: ${minChanged}%`,
  "",
  "| Area | Base total | PR total | Δ | Changed-line coverage |",
  "| --- | ---: | ---: | ---: | ---: |",
  ...rows.filter((r) => r.total || r.changedTotal || r.baseCoverage != null).map((r) => `| ${r.label} | ${fmt(r.baseCoverage)} | ${fmt(r.coverage)} (${r.covered}/${r.total}) | ${fmtDelta(r.coverageDelta)} | ${fmt(r.changedCoverage)} (${r.changedCovered}/${r.changedTotal}) |`),
  "",
  failed.length ? `❌ Changed-code coverage is below ${minChanged}% for: ${failed.map((r) => r.label).join(", ")}.` : `✅ Changed-code coverage meets ${minChanged}% for all touched areas with executable lines.`,
  "",
].join("\n"));
console.log(readFileSync(outMd, "utf8"));
if (failed.length) process.exit(1);
}
