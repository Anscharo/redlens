// Which PR commits deploy the same app as the head commit. Railway skips a push
// whose changes are all paths that never deploy (deploy-skip.mjs), so the PR
// environment can be serving an older commit, and an E2E run against it tested
// what head would ship. The E2E gate accepts a run at any of these commits.
import { execFileSync } from "node:child_process";

import { isDeployRelevant } from "./deploy-skip.mjs";

/**
 * Head, then each older commit (newest first) whose diff to head touches no
 * deploy-relevant path. Stops at the first commit that differs from head in a
 * deploy-relevant path.
 *
 * @param {string} head
 * @param {{ sha: string, changedSinceHead: string[] }[]} ancestors newest first
 */
export function deployEquivalentShas(head, ancestors) {
  const shas = [head];
  for (const { sha, changedSinceHead } of ancestors) {
    if (changedSinceHead.some(isDeployRelevant)) break;
    shas.push(sha);
  }
  return shas;
}

/**
 * The PR's commits older than `head`, newest first, each with the paths that
 * differ between it and head. Capped at `limit`; any git error yields [], which
 * leaves the gate waiting for head alone.
 */
export function ancestorsFromGit(head, base, limit = 20, git = runGit) {
  try {
    const shas = git(["rev-list", "--first-parent", `--max-count=${limit + 1}`, `${base}..${head}`]).slice(1);
    return shas.map((sha) => ({ sha, changedSinceHead: git(["diff", "--name-only", sha, head]) }));
  } catch {
    return [];
  }
}

/** deployEquivalentShas over this checkout's history; head alone without a base. */
export function deployEquivalentShasFromGit(head, base) {
  return base ? deployEquivalentShas(head, ancestorsFromGit(head, base)) : [head];
}

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
}
