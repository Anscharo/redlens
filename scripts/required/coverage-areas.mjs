#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const repo = process.cwd();
const lcovPath = process.env.COVERAGE_LCOV ?? "coverage/lcov.info";
const outJson = process.env.COVERAGE_AREAS_JSON ?? "coverage/coverage-areas.json";
const outMd = process.env.COVERAGE_AREAS_MD ?? "coverage/coverage-summary.md";
const baseRef = process.env.COVERAGE_BASE_REF ?? process.env.GITHUB_BASE_REF ?? "origin/main";
const baselinePath = process.env.COVERAGE_BASELINE_JSON;
const minChanged = Number(process.env.COVERAGE_CHANGED_MIN ?? "95");

const areas = [
  { id: "react", label: "React app", match: [/^src\/(components|hooks)\/.*\.tsx$/, /^src\/(App|main)\.tsx$/] },
  { id: "frontend-workers", label: "Front-end workers", match: [/^src\/workers\//] },
  { id: "backend-routes", label: "Backend routes", match: [/^src\/server\/(index|http|sse|auth|mcp|posthog-proxy)\.ts$/, /^src\/server\/preview\/handler\.ts$/] },
  { id: "backend-workers", label: "Backend workers", match: [/^src\/server\/(atlas-updater|atlas-refresh|sync|sync-embeddings|prefetch)\.ts$/, /^src\/server\/preview\/(sweeper|build)\.ts$/, /^scripts\/required\/atlas-worker\.mjs$/] },
  { id: "backend-core", label: "Backend core", match: [/^src\/server\//] },
  { id: "general-utils", label: "General utils/units", match: [/^src\/lib\//, /^scripts\/lib\//] },
];

function areaFor(file) {
  const matches = areas.filter((area) => area.match.some((re) => re.test(file))).map((area) => area.id);
  if (matches.includes("backend-routes")) return "backend-routes";
  if (matches.includes("backend-workers")) return "backend-workers";
  if (matches.includes("backend-core")) return "backend-core";
  return matches[0] ?? "uncategorized";
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
  const diff = execFileSync("git", ["diff", "--unified=0", `${baseRef}...HEAD`, "--", "src", "scripts"], { encoding: "utf8" });
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

if (!existsSync(lcovPath)) {
  console.error(`Missing ${lcovPath}. Run coverage before coverage:areas.`);
  process.exit(1);
}

const lcov = parseLcov(readFileSync(lcovPath, "utf8"));
const changed = changedLines();
const summary = Object.fromEntries(areas.map((area) => [area.id, { ...area, covered: 0, total: 0, changedCovered: 0, changedTotal: 0 }]));
summary.uncategorized = { id: "uncategorized", label: "Uncategorized", covered: 0, total: 0, changedCovered: 0, changedTotal: 0 };

for (const [file, lines] of lcov) {
  const bucket = summary[areaFor(file)];
  for (const hits of lines.values()) {
    bucket.total += 1;
    if (hits > 0) bucket.covered += 1;
  }
  for (const lineNo of changed.get(file) ?? []) {
    if (!lines.has(lineNo)) continue;
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
writeFileSync(outJson, `${JSON.stringify({ minChanged, baseRef, rows, failed }, null, 2)}\n`);
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
