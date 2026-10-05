#!/usr/bin/env node
// Comment gate: added comment lines must state what holds now, not narrate history.
// Rules and the `history-ok` opt-out live in scripts/lib/history-comments.ts.
//
//   pnpm check:comments            judge lines added since the base (CI: the PR base)
//   pnpm check:comments --base=SHA judge lines added since SHA
import { execFileSync } from "node:child_process";
import { scanDiff } from "../lib/history-comments.ts";
import { resolveDiffBase } from "../lib/diff-base.mjs";

const base = resolveDiffBase();
if (!base) {
  console.log("check:comments — no diff base (no origin/main?); nothing to judge.");
  process.exit(0);
}

const diff = execFileSync("git", ["diff", "-U0", "--no-color", "--diff-filter=AMR", base, "--", "src", "apps", "scripts"], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
});
const findings = scanDiff(diff);
for (const f of findings) {
  const msg = `${f.why} in a comment. State the current rule and its reason; history goes in the commit/PR (or mark the line history-ok). ${f.text}`;
  if (process.env.GITHUB_ACTIONS) console.log(`::error file=${f.path},line=${f.line}::${msg}`);
  else console.log(`✗ ${f.path}:${f.line} ${msg}`);
}
console.log(`check:comments — ${findings.length} history comment(s) added since ${base.slice(0, 8)}.`);
process.exit(findings.length ? 1 : 0);
