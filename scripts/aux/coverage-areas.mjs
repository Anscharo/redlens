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
// A percentage gate has no resolution on a small diff: change 3 logic lines and
// the only scores available are 0 / 33 / 67 / 100, so a single uncovered line —
// often a `console.warn` or an early-return guard — reads as 67% and fails a
// gate that a 100-line PR clears with 15 uncovered lines. The grace forgives
// that many uncovered changed lines outright; its proportional weight fades as
// the diff grows (a whole line out of 100 barely moves the percentage), so the
// gate only loosens exactly where the percentage was too coarse to be fair.
const graceLines = Number(process.env.COVERAGE_CHANGED_GRACE ?? "1");

// React code (components / hooks / context) is split into per-product meters so
// each product's test coverage is tracked on its own. Ordering is load-bearing:
// areaFor() returns the FIRST area whose pattern matches, so specific product
// buckets are listed before the broad `react-general` catch-all, and the React
// buckets sit before the `lib-*` buckets (whose `lib-shared` catch-all uses
// `^src/lib/` and would otherwise swallow the lib/*.tsx context providers). The
// set of React bucket ids below is proved to be a total + disjoint partition of
// the React file set by scripts_tests/coverage-areas.test.ts — keep the two in sync.
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
      /^src\/components\//, // remaining components: preview, app shell
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
  // The product files now live in per-product FOLDERS (src/server/{chat,chat/tools,
  // chat/verify,retrieval,history}/), so each meter is just a folder prefix and the
  // set of files stays honest as code is added/moved. Ordering is load-bearing
  // (areaFor returns the FIRST match): these sit AFTER backend-routes + backend-workers
  // (so preview/handler.ts stays a route and preview/{build,sweeper}.ts stay workers),
  // chat/tools + chat/verify precede the broad chat/ prefix, and the whole set sits
  // BEFORE the backend-core misc catch-all. Proved a total partition of src/server/
  // by scripts_tests/coverage-areas.test.ts — keep in sync.
  { id: "backend-preview", label: "Backend · PR review (preview)", match: [/^src\/server\/preview\//] },
  { id: "backend-history", label: "Backend · History", match: [/^src\/server\/history\//] },
  // The LLM tool layer the chat agent calls: registry + graph/history tool impls.
  { id: "backend-chat-tools", label: "Backend · Chat/AI (tools)", match: [/^src\/server\/chat\/tools\//] },
  // Answer grounding: verifier(s), verify-checks, citation repair + stream gate, round checks, advisor.
  { id: "backend-chat-verify", label: "Backend · Chat/AI (verify)", match: [/^src\/server\/chat\/verify\//] },
  // Conversation orchestration + LLM plumbing. Listed after chat/tools + chat/verify
  // so those claim their nested files; this catches the rest of chat/.
  { id: "backend-chat", label: "Backend · Chat/AI (core)", match: [/^src\/server\/chat\//] },
  // RAG/search retrieval: query build, indexes, keyword search, embeddings, entity/doc resolve.
  { id: "backend-retrieval", label: "Backend · Retrieval", match: [/^src\/server\/retrieval\//] },
  { id: "backend-reports", label: "Backend · Reports", match: [/^src\/server\/reports\//] },
  // Misc catch-all — everything else at src/server/ root (config, og/og-image, bundle-store,
  // collections, session, rate-limit, migrate, db, posthog-*, atlas-static, stream helpers). Keep last.
  { id: "backend-core", label: "Backend · Core (misc)", match: [/^src\/server\//] },
  // ---- lib product meters ----
  // `general-utils` used to be a single ~17k-line catch-all over ALL of src/lib/
  // + scripts/lib/. Split into per-product meters the same way backend-core was,
  // so each product's lib coverage is tracked on its own instead of one meter
  // averaging over everything from report math to markdown rendering. Ordering
  // is load-bearing (areaFor returns the FIRST match): react-general (above)
  // must precede these so the src/lib/*.tsx context providers stay React; the
  // specific lib-* buckets below use explicit filename alternations, so their
  // relative order doesn't matter EXCEPT `lib-shared` and `scripts-lib-core`,
  // which are trailing catch-alls (`^src/lib/` / `^scripts/lib/`) and MUST stay
  // last in their respective groups so new/uncategorized files still land
  // somewhere instead of leaking to `uncategorized`. Proved a total + disjoint
  // partition of src/lib/ and scripts/lib/ by scripts_tests/coverage-areas.test.ts.
  {
    id: "lib-reports-duty",
    label: "Lib · Reports (duty/risk/OEA)",
    match: [/^src\/lib\/(oeaAssessment|oeaReport|oeaTasks|riskAssessment|riskAssessmentIndex|riskRules|dutyText|dutyCollapse|facilitatorResponsibilities|govopsResponsibilities)\.ts$/],
  },
  {
    id: "lib-reports-activity",
    label: "Lib · Reports (activity/rewards)",
    match: [/^src\/lib\/(rewardsSearch|rewardsTypes|rewardsIndex|modFrequencyCharts|modFrequencyIndex|activeDataIndex|actorIndex|onchainAddressesIndex|processesIndex|primitiveStats|reportChains|treemap|productArea|owningAgent|reportFilter|csv|csvDownload|staleChunk|staleDates|curationStore)\.ts$/],
  },
  {
    id: "lib-crossview",
    label: "Lib · CrossView",
    match: [/^src\/lib\/(crossview|crossviewHeadings|crossviewIndex|crossviewShape|conceptsCensus)\.ts$/],
  },
  {
    id: "lib-diff-preview",
    label: "Lib · Diff/Preview",
    match: [/^src\/lib\/(diffCore|diffFences|diffIslands|diffProse|diffSentences|diffSubclause|previewLocal|previewFilter)\.ts$/],
  },
  {
    id: "lib-address-chain",
    label: "Lib · Address/Chain",
    match: [/^src\/lib\/(addresses|addressMap|balances|chainstate|explorer|tokens|rehypeEthAddresses)\.ts$/],
  },
  {
    id: "lib-search",
    label: "Lib · Search",
    match: [/^src\/lib\/(search|searchOptions|searchHighlight|recentSearches|hitLabels|uuidSearch)\.ts$/],
  },
  {
    id: "lib-atlas-core",
    label: "Lib · Atlas core/render",
    match: [
      /^src\/lib\/(docs|docsTypes|atlasHelpers|atlasBase|atlasSubset|depth|breadcrumbs|treeUtils|selectedTree|cousins|anchorId|chevronSettle|scrollMemory|scrollRequestStore|revealStore|animatedScroll|shortenTitle|layout|slug|routes)\.ts$/,
      /^src\/lib\/(history|visitHistory)\.ts$/,
      /^src\/lib\/(glossary|glossaryLookup|rehypeHeadingIds|rehypeHighlightMarks|rehypeEvidencePills|rehypeDocRefs|stripMarkdownLinks|patterns|mathGuard)\.ts$/,
    ],
  },
  {
    id: "lib-graph",
    label: "Lib · Graph",
    match: [/^src\/lib\/(graph|graphData|entityGraph|instanceDescendants|roleEdges|docRefResolver)\.ts$/],
  },
  // Misc catch-all — auth, collections, analytics, and generic infra (format,
  // idb, health, patchNotes, verify, tools, etc.) at src/lib root. Keep last.
  { id: "lib-shared", label: "Lib · Shared/infra", match: [/^src\/lib\//] },
  {
    id: "scripts-lib-graph",
    label: "Scripts lib · Graph extraction",
    match: [/^scripts\/lib\/(graph-active-data|graph-address-enrich|graph-bridges|graph-doc-edges|graph-duties|graph-entities|graph-entity-edges|graph-instances|graph-multisigs|graph-omni|graph-patterns|graph-transfers|graph-transitions|graph-tripwires)\.mjs$/],
  },
  {
    id: "scripts-lib-address",
    label: "Scripts lib · Address/chain",
    match: [/^scripts\/lib\/(address-annotate|address-chains|address-code|address-enrich|solana-accounts|solana-pda)\.mjs$/],
  },
  // Misc catch-all — atlas/table parsing, history classification, and small
  // build-pipeline utils (natural-sort, census-fingerprint, patch-notes-validate,
  // process-keywords, chains, worker-heartbeat). Keep last.
  { id: "scripts-lib-core", label: "Scripts lib · Core (parsing/misc)", match: [/^scripts\/lib\//] },
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

// Ids of the lib meters (the product split of the former single `general-utils`
// bucket), in display order. The proof test asserts every non-React src/lib file
// and every scripts/lib file maps to exactly one of these. `lib-shared` and
// `scripts-lib-core` are the misc catch-alls, so totality holds automatically for
// any new file in either directory.
export const libAreaIds = areas.filter((a) => a.id.startsWith("lib-") || a.id.startsWith("scripts-lib-")).map((a) => a.id);

// First match wins. Specific areas precede broad ones in `areas`, so a plain
// ordered scan yields the correct bucket (e.g. backend-routes before backend-core,
// react-reader-* before react-general before general-utils).
export function areaFor(file) {
  // The frontend moved to apps/web/ but the meters below are keyed on the paths
  // as they read in the repo's own vocabulary ("src/components/radar"). Strip the
  // package prefix here rather than teaching ~30 regexes about it — coverage is
  // reported as one number across both packages either way.
  file = file.replace(/^apps\/web\//, "");
  const area = areas.find((a) => a.match.some((re) => re.test(file)));
  return area?.id ?? "uncategorized";
}

function pct(covered, total) {
  return total ? (covered / total) * 100 : null;
}

// The changed-code gate: a bucket passes when its changed-line coverage clears
// the minimum, OR when at most `grace` of its changed logic lines are uncovered
// (see graceLines above). Applied twice in runMain — once per area, once to the
// whole diff. The overall pass is what stops the per-area grace from stacking:
// a diff spread thin across six meters would otherwise collect six forgiven
// lines and slip through at 50%, so the same rule over the summed changed lines
// keeps the grace worth one line per PR, not one per meter it happens to touch.
export function meetsChangedMin(changedCovered, changedTotal, min = minChanged, grace = graceLines) {
  if (changedTotal <= 0) return true; // nothing instrumented changed here
  if (changedTotal - changedCovered <= grace) return true;
  return (changedCovered / changedTotal) * 100 >= min;
}

function fmt(value) {
  return value == null ? "n/a" : `${value.toFixed(2)}%`;
}

function fmtDelta(value) {
  if (value == null) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)} pts`;
}

// Merge per-runner LCOV reports. Hits always sum. The line set is the
// intersection of every runner's instrumented lines, plus any line at least
// one runner actually executed (hits > 0).
//
// Picking the runner with the greatest total hits (the previous rule) failed
// when bun both imported a scripts/lib helper (pickAtlasCommit, hundreds of
// hits) AND emitted DA:0 rows for functions it never called (`gitHead`,
// `stampAtlasCommit`) and for object-literal continuations v8 does not
// consider executable. Those zeros became the denominator and failed the
// changed-line gate on code vitest had fully tested. Intersection drops the
// phantom DA:0 extras; the hits>0 union keeps a line only one runner executed
// (e.g. vitest's catch-body `return null` when bun attributed the same catch
// to a different line). A file only one runner recorded keeps that runner's
// lines untouched.
export function mergeLcovReports(reports) {
  const perFile = new Map();
  for (const report of reports) {
    for (const [file, lines] of report) {
      if (!perFile.has(file)) perFile.set(file, []);
      perFile.get(file).push(lines);
    }
  }
  const merged = new Map();
  for (const [file, fileReports] of perFile) {
    if (fileReports.length === 1) {
      merged.set(file, fileReports[0]);
      continue;
    }
    const intersection = new Set(fileReports[0].keys());
    for (const lines of fileReports.slice(1)) {
      for (const n of [...intersection]) {
        if (!lines.has(n)) intersection.delete(n);
      }
    }
    const out = new Map();
    const add = (lineNo) => {
      if (out.has(lineNo)) return;
      let sum = 0;
      for (const lines of fileReports) sum += lines.get(lineNo) ?? 0;
      out.set(lineNo, sum);
    };
    for (const n of intersection) add(n);
    for (const lines of fileReports) {
      for (const [n, hits] of lines) {
        if (hits > 0) add(n);
      }
    }
    merged.set(file, out);
  }
  return merged;
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
  // coverage.include is src/**/*.{ts,tsx} + apps/web/src/**/*.{ts,tsx} +
  // scripts/lib/**/*.mjs; bun's coverage only sees modules src/server tests
  // load). A changed file outside this scope — e.g. a scripts/required/*.mjs
  // build script — would never appear in either LCOV, so the per-file loop
  // below could never count its changed lines and the coverage gate would
  // silently pass it as untested.
  //
  // apps/web is listed because the frontend lives there now. Without it this
  // gate stops seeing every component and hook — it would keep passing while
  // measuring nothing, which is worse than failing.
  //
  // maxBuffer is raised off the 1 MB default: a large refactor (the workspace
  // split diffed ~1 MB here) overflows it, and execFileSync then throws rather
  // than returning truncated output, taking the whole gate down with it.
  const diff = execFileSync(
    "git",
    ["diff", "--unified=0", `${baseRef}...HEAD`, "--", "src", "apps/web/src", "scripts/lib"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
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
export function isLogicLine(file, lineNo) {
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
  // A comment is documentation, not logic. This is not hypothetical tidiness:
  // bun's LCOV emits DA records for comment lines where v8's does not, and for
  // a scripts/lib module that a src/server test merely imports, every one of
  // those records is 0. Since the two reports are merged by line number, an
  // added comment block then lands in the denominator as uncovered code —
  // penalising a change whose actual statements are fully tested.
  if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) return false;
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

const lcov = mergeLcovReports(
  lcovPaths.map((lcovPath) => parseLcov(readFileSync(lcovPath, "utf8"))),
);
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
const failed = rows.filter((row) => row.changedTotal > 0 && !meetsChangedMin(row.changedCovered, row.changedTotal));
const overall = {
  changedCovered: rows.reduce((sum, row) => sum + row.changedCovered, 0),
  changedTotal: rows.reduce((sum, row) => sum + row.changedTotal, 0),
};
overall.changedCoverage = pct(overall.changedCovered, overall.changedTotal);
overall.passed = meetsChangedMin(overall.changedCovered, overall.changedTotal);
const gateLabel = `${minChanged}%${graceLines > 0 ? `, or all but ${graceLines} changed line${graceLines === 1 ? "" : "s"}` : ""}`;
mkdirSync(path.dirname(outJson), { recursive: true });
writeFileSync(outJson, `${JSON.stringify({ minChanged, graceLines, baseRef, lcovPaths, rows, failed, overall }, null, 2)}\n`);
writeFileSync(outMd, [
  "### Coverage by area",
  "",
  `Changed-code minimum: ${gateLabel}`,
  "",
  "| Area | Base total | PR total | Δ | Changed-line coverage |",
  "| --- | ---: | ---: | ---: | ---: |",
  ...rows.filter((r) => r.total || r.changedTotal || r.baseCoverage != null).map((r) => `| ${r.label} | ${fmt(r.baseCoverage)} | ${fmt(r.coverage)} (${r.covered}/${r.total}) | ${fmtDelta(r.coverageDelta)} | ${fmt(r.changedCoverage)} (${r.changedCovered}/${r.changedTotal}) |`),
  ...(overall.changedTotal ? ["", `All changed lines: ${fmt(overall.changedCoverage)} (${overall.changedCovered}/${overall.changedTotal})`] : []),
  "",
  failed.length
    ? `❌ Changed-code coverage misses the minimum (${gateLabel}) for: ${failed.map((r) => r.label).join(", ")}.`
    : overall.passed
      ? `✅ Every touched area with executable lines meets the changed-code minimum (${gateLabel}).`
      : `❌ Each area is within its ${graceLines}-line grace, but the diff as a whole misses ${minChanged}% (${overall.changedCovered}/${overall.changedTotal} changed lines covered).`,
  "",
].join("\n"));
console.log(readFileSync(outMd, "utf8"));
if (failed.length || !overall.passed) process.exit(1);
}
