#!/usr/bin/env node
// Size gate, delegated to oxlint's max-lines / max-lines-per-function rules:
//   .oxlintrc.size.json       hard limits + grandfathered files, over the whole tree (fails)
//   .oxlintrc.size-warn.json  advisory limits: over files added since the base (fails, since a
//                             new file has no history to grandfather), over files modified
//                             since the base (never fails)
//
//   pnpm check:size            CI passes the PR base via DIFF_BASE; locally merge-base with origin/main
//   pnpm check:size --all      advisory limits over the whole tree
import { spawnSync } from "node:child_process";
import { resolveDiffBase, changedPaths, addedPaths } from "../lib/diff-base.mjs";

const ROOTS = ["src", "apps/web/src", "scripts"];
const IN_SCOPE_RE = /^(src|apps\/web\/src|scripts)\/.+\.(m?[jt]sx?)$/;

const oxlint = (config, paths, ...flags) =>
  spawnSync("oxlint", ["-c", config, ...flags, ...paths], { stdio: "inherit", shell: process.platform === "win32" })
    .status;

function diffScoped() {
  if (process.argv.includes("--all")) return { added: [], modified: ROOTS };
  const base = resolveDiffBase();
  if (!base) return { added: [], modified: [] };
  const added = [...addedPaths(base)].filter((p) => IN_SCOPE_RE.test(p));
  const isAdded = new Set(added);
  const modified = [...changedPaths(base)].filter((p) => IN_SCOPE_RE.test(p) && !isAdded.has(p));
  return { added, modified };
}

let status = oxlint(".oxlintrc.size.json", ROOTS) ?? 1;
const { added, modified } = diffScoped();
if (added.length) {
  console.log(`\nNew files must meet the advisory limits (${added.length} added file(s)):`);
  const newStatus = oxlint(".oxlintrc.size-warn.json", added, "--deny-warnings") ?? 1;
  status ||= newStatus;
}
if (modified.length) {
  console.log(`\nAdvisory size limits (${modified.length} modified file(s)):`);
  oxlint(".oxlintrc.size-warn.json", modified);
}
process.exit(status);
