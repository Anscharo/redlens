// Skip-visibility guard for the preview canary (runs in e2e.yml after the
// canary step). The canary is skip-tolerant by design — no eligible atlas PR
// is an honest quiet day — but perpetual silent skipping is indistinguishable
// from a broken feature. This reads Playwright's JSON report, keeps a
// consecutive-scheduled-skip counter in a file the workflow persists via
// actions/cache, warns on every scheduled skip, and fails the run outright
// once the streak crosses MAX_STREAK so the silence becomes red.
//
// Env: REPORT_FILE (Playwright JSON report), STREAK_FILE (counter, cached),
//      EVENT_NAME (github.event_name), MAX_STREAK (default 6 ≈ 2 days at the
//      3-runs/day schedule), GITHUB_STEP_SUMMARY (optional).
import fs from "node:fs";
import path from "node:path";

const reportFile = process.env.REPORT_FILE;
const streakFile = process.env.STREAK_FILE;
const eventName = process.env.EVENT_NAME ?? "";
const maxStreak = Number(process.env.MAX_STREAK ?? "6");

if (!reportFile || !streakFile) {
  console.error("REPORT_FILE and STREAK_FILE are required");
  process.exit(1);
}
if (!fs.existsSync(reportFile)) {
  // A missing report is a harness misconfiguration, not a quiet day.
  console.error(`::error::canary skip guard: Playwright JSON report not found at ${reportFile}`);
  process.exit(1);
}

/** Flatten Playwright's nested suite tree into [{file, title, status, annotations}]. */
function collectTests(suite, acc = []) {
  for (const child of suite.suites ?? []) collectTests(child, acc);
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      acc.push({
        file: suite.file ?? spec.file ?? "",
        title: spec.title,
        // expectedStatus-aware rollup: "skipped" | "expected" | "unexpected" | "flaky"
        status: t.status,
        annotations: t.annotations ?? [],
      });
    }
  }
  return acc;
}

const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const tests = (report.suites ?? []).flatMap((s) => collectTests(s));
const preview = tests.filter((t) => t.file.endsWith("preview.spec.ts"));

if (!preview.length) {
  console.error("::error::canary skip guard: no preview.spec.ts test in the report — was the canary project run?");
  process.exit(1);
}

const ran = preview.some((t) => t.status !== "skipped");
const skipReason =
  preview
    .flatMap((t) => t.annotations)
    .find((a) => a.type === "skip" && a.description)?.description ?? "no reason recorded";

const prior = fs.existsSync(streakFile) ? Number(fs.readFileSync(streakFile, "utf8").trim()) || 0 : 0;
// Any execution (pass or fail) proves the canary can run; only scheduled
// skips extend the streak — a pin-less manual dispatch shouldn't poison it.
const streak = ran ? 0 : eventName === "schedule" ? prior + 1 : prior;
fs.mkdirSync(path.dirname(streakFile), { recursive: true });
fs.writeFileSync(streakFile, `${streak}\n`);

const summary = ran
  ? `preview canary ran (skip streak reset; was ${prior})`
  : `preview canary skipped: ${skipReason} (scheduled skip streak: ${streak}/${maxStreak})`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${summary}\n`);
}

if (!ran && eventName === "schedule") {
  if (streak >= maxStreak) {
    console.error(
      `::error::preview canary has skipped ${streak} consecutive scheduled runs (last reason: ${skipReason}) — ` +
        "the preview feature has not been exercised for days; check discovery eligibility vs the current atlas layout",
    );
    process.exit(1);
  }
  console.warn(`::warning::preview canary skipped this scheduled run: ${skipReason}`);
}
