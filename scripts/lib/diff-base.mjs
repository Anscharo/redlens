// Resolves which commit a change is measured against, and what it touched.
// CI passes the PR's base sha explicitly; locally the merge-base with origin/main
// stands in. Null means "no base available": callers fall back to whole-repo mode.
import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

export function resolveDiffBase(argv = process.argv, env = process.env) {
  const flag = argv.find((a) => a.startsWith("--base="));
  const explicit = flag?.slice("--base=".length) || env.DIFF_BASE;
  try {
    return explicit ? git("rev-parse", "--verify", `${explicit}^{commit}`) : git("merge-base", "HEAD", "origin/main");
  } catch {
    return null;
  }
}

/**
 * Paths added or modified since `base`: committed, uncommitted and untracked.
 * Two-dot against the working tree, so CI's shallow PR merge commit works without history.
 */
export function changedPaths(base) {
  const tracked = git("diff", "--name-only", "--diff-filter=AMR", base);
  const untracked = git("ls-files", "-o", "--exclude-standard");
  return new Set(`${tracked}\n${untracked}`.split("\n").filter(Boolean));
}
