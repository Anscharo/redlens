#!/usr/bin/env node
// Size gate: files and functions over the limits in scripts/lib/size-ratchet.mjs
// fail unless grandfathered in .github/size-baseline.json, and grandfathered items
// may only shrink.
//
//   pnpm check:size            check (warnings only for files changed vs the base)
//   pnpm check:size --update   tighten the baseline to current sizes; never loosens it
//   pnpm check:size --accept   also admit new/grown offenders; say why in the PR
//   pnpm check:size --all      warn about every file, not just changed ones
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { measureSource } from "../lib/size-metrics.mjs";
import { inSizeScope, ratchet, describe } from "../lib/size-ratchet.mjs";
import { resolveDiffBase, changedPaths } from "../lib/diff-base.mjs";

const BASELINE = ".github/size-baseline.json";
const args = new Set(process.argv.slice(2));
const annotate = Boolean(process.env.GITHUB_ACTIONS);

function measureRepo() {
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" }).split("\n").filter(inSizeScope);
  return new Map(files.filter((f) => fs.existsSync(f)).map((f) => [f, measureSource(f, fs.readFileSync(f, "utf8"))]));
}

function report(findings) {
  for (const f of findings) {
    const level = f.level === "warn" ? "warning" : "error";
    if (annotate) console.log(`::${level} file=${f.path},line=${f.line}::${describe(f)}`);
    else console.log(`${level === "error" ? "✗" : "!"} ${describe(f)}`);
  }
}

function writeBaseline(entries, label) {
  fs.writeFileSync(BASELINE, `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`${label} ${BASELINE}: ${Object.keys(entries).length} grandfathered items.`);
}

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : {};
const base = args.has("--all") ? null : resolveDiffBase();
const { findings, tightened, accepted } = ratchet(measureRepo(), baseline, base ? changedPaths(base) : null);

if (args.has("--accept")) writeBaseline(accepted, "Accepted all current offenders into");
else if (args.has("--update")) writeBaseline(tightened, "Tightened");

const blocking = args.has("--accept") ? [] : findings.filter((f) => f.level === "error" || (f.level === "stale" && !args.has("--update")));
// Without a base every file is "changed"; listing ~700 advisories would bury the errors.
const listWarnings = Boolean(base) || args.has("--all");
report(findings.filter((f) => (f.level === "warn" && listWarnings) || blocking.includes(f)));
const warned = findings.filter((f) => f.level === "warn").length;
console.log(`check:size — ${blocking.length} blocking, ${warned} advisory${base ? ` (advisory scoped to changes since ${base.slice(0, 8)})` : ""}.`);
process.exit(blocking.length ? 1 : 0);
