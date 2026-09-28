// Pure keep/delete decisions for `pnpm env:prune`. No I/O, so the rules that
// decide whether an environment gets DELETED are unit-testable on their own —
// see scripts_tests/prune-plan.test.ts.

import { prNumberFromRailwayEnv } from "./deploy-skip.mjs";

/**
 * Long-lived environments on this repo, as enumerated from the live list
 * 2026-09-28. The regex is the real gate — none of these parse as a PR
 * environment — so this is defence in depth against a future loosening of it.
 * Listing a name that does not exist costs nothing, which is why the list errs
 * long: an entry can only ever protect, never delete.
 */
export const PROTECTED_ENVIRONMENTS = Object.freeze([
  "github-pages",
  "CI",
  "atlas-update-main-bypass",
  "production",
  "prod",
  "development",
  "WorkerDeploy",
  "CF Page Deploy",
  "redlens (Preview)",
  "miraculous-prosperity",
  "scintillating-delight",
]);

/**
 * Protected by full name OR by last path segment, because GitHub prefixes a
 * Railway environment with its service ("Redline Atlas / production") and the
 * prefix is not ours to predict.
 */
export function isProtected(name, extraKeeps = []) {
  const set = new Set([...PROTECTED_ENVIRONMENTS, ...extraKeeps].map((n) => n.toLowerCase()));
  const full = String(name).trim().toLowerCase();
  const segment = full.split("/").pop().trim();
  return set.has(full) || set.has(segment);
}

/**
 * Argument parsing, separated out because one of its edge cases is a footgun:
 * a bare trailing `--pr` used to read as "no --pr given" and silently widen a
 * single-PR prune into a full sweep. A PRESENT flag with a missing value is an
 * error, never a fallthrough.
 */
export function parsePruneArgs(argv) {
  const has = (n) => argv.includes(n);
  const valueOf = (n) => (has(n) ? argv[argv.indexOf(n) + 1] : undefined);

  let onlyPr;
  if (has("--pr")) {
    const raw = valueOf("--pr");
    onlyPr = Number(raw);
    if (raw === undefined || raw === "" || !Number.isInteger(onlyPr) || onlyPr <= 0) {
      throw new Error(`--pr expects a positive integer, got ${JSON.stringify(raw)}`);
    }
  }

  const keeps = argv.flatMap((a, i) => (a === "--keep" ? [argv[i + 1]] : [])).filter(Boolean);
  return { apply: has("--apply"), orphans: has("--orphans"), onlyPr, keeps, repo: valueOf("--repo") };
}

/** Environments that are even eligible to be looked up, and how many were not. */
export function selectCandidates(environments, { onlyPr, keeps = [] } = {}) {
  const candidates = [];
  let keptCount = 0;
  for (const env of environments) {
    const pr = isProtected(env.name, keeps) ? null : prNumberFromRailwayEnv(env.name);
    if (pr === null || (onlyPr !== undefined && pr !== onlyPr)) keptCount += 1;
    else candidates.push({ name: env.name, pr });
  }
  return { candidates, keptCount };
}

/**
 * A 404 from /pulls/{n} means either "no such PR" or "this token may not read
 * pull requests" — GitHub does not distinguish them. A token with
 * Administration: write and no Pull requests: read therefore marks EVERY
 * candidate missing, and `--orphans` would then delete environments belonging
 * to open PRs, including the current one. Every lookup failing at once is not a
 * repo where every PR vanished; it is a scope problem, so callers must refuse.
 * One candidate is exempt: `--pr <n>` against a genuinely absent PR is a real
 * single-miss answer.
 */
export function looksLikeMissingPrScope(candidates, states) {
  if (candidates.length < 2) return false;
  return candidates.every((c) => states.get(c.pr) === "missing");
}

/** The final split. `doomed` is what gets deleted. */
export function planPrune(candidates, states, { orphans = false } = {}) {
  const by = (s) => candidates.filter((c) => states.get(c.pr) === s);
  const stale = by("closed");
  const unknown = by("missing");
  return { open: by("open"), stale, unknown, doomed: orphans ? [...stale, ...unknown] : stale };
}
