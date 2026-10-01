#!/usr/bin/env node
// Size gate, delegated to oxlint's max-lines / max-lines-per-function rules:
//   .oxlintrc.size.json       hard limits + grandfathered files, over the whole tree (fails)
//   .oxlintrc.size-warn.json  advisory limits, over files changed since the base (never fails)
//
//   pnpm check:size            CI passes the PR base via DIFF_BASE; locally merge-base with origin/main
//   pnpm check:size --all      advisory limits over the whole tree
import { spawnSync } from "node:child_process";
import { resolveDiffBase, changedPaths } from "../lib/diff-base.mjs";

const ROOTS = ["src", "apps/web/src", "scripts"];
const IN_SCOPE_RE = /^(src|apps\/web\/src|scripts)\/.+\.(m?[jt]sx?)$/;

const oxlint = (config, paths) =>
  spawnSync("oxlint", ["-c", config, ...paths], { stdio: "inherit", shell: process.platform === "win32" }).status;

function advisoryPaths() {
  if (process.argv.includes("--all")) return ROOTS;
  const base = resolveDiffBase();
  if (!base) return [];
  return [...changedPaths(base)].filter((p) => IN_SCOPE_RE.test(p));
}

const status = oxlint(".oxlintrc.size.json", ROOTS);
const advisory = advisoryPaths();
if (advisory.length) {
  console.log(`\nAdvisory size limits (${advisory.length} changed file(s)):`);
  oxlint(".oxlintrc.size-warn.json", advisory);
}
process.exit(status ?? 1);
