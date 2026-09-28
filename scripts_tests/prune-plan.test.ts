import { describe, expect, it } from "vitest";
import {
  PROTECTED_ENVIRONMENTS,
  isProtected,
  looksLikeMissingPrScope,
  parsePruneArgs,
  planPrune,
  selectCandidates,
} from "../scripts/lib/prune-plan.mjs";

const envs = (...names: string[]) => names.map((name) => ({ name }));

// The live list as of 2026-09-28, trimmed to one of each shape.
const LIVE = envs(
  "github-pages",
  "CI",
  "atlas-update-main-bypass",
  "Redline Atlas / production",
  "Redline Atlas / development",
  "WorkerDeploy",
  "CF Page Deploy",
  "redlens (Preview)",
  "Redline Atlas / miraculous-prosperity",
  "expr-12", // substring, must not parse
  "Redline Atlas / redlens-pr-400", // open
  "Redline Atlas / redlens-pr-401", // closed
  "Redline Atlas / pr-c5cc69-210", // closed, old slug shape
  "Redline Atlas / redlens-pr-999", // no such PR
);
const STATES = new Map<number, string>([
  [400, "open"],
  [401, "closed"],
  [210, "closed"],
  [999, "missing"],
]);

describe("parsePruneArgs", () => {
  // The bug this pins: a bare trailing `--pr` read as "no --pr given", so
  // `--apply --pr` silently widened a single-PR prune into a full sweep.
  it("refuses a present --pr with no value instead of falling through", () => {
    for (const argv of [["--pr"], ["--apply", "--pr"], ["--pr", ""], ["--pr", "--apply"]]) {
      expect(() => parsePruneArgs(argv), argv.join(" ")).toThrow(/--pr expects a positive integer/);
    }
  });

  it("accepts a real PR number and reads the other flags", () => {
    expect(parsePruneArgs(["--pr", "418"]).onlyPr).toBe(418);
    expect(parsePruneArgs([]).onlyPr).toBeUndefined();
    expect(parsePruneArgs(["--apply", "--orphans"])).toMatchObject({ apply: true, orphans: true });
    expect(parsePruneArgs([])).toMatchObject({ apply: false, orphans: false });
    expect(parsePruneArgs(["--keep", "a", "--keep", "b"]).keeps).toEqual(["a", "b"]);
    expect(parsePruneArgs(["--repo", "o/r"]).repo).toBe("o/r");
  });

  it("rejects a non-positive or non-integer --pr", () => {
    for (const bad of ["0", "-3", "abc", "4.5"]) {
      expect(() => parsePruneArgs(["--pr", bad]), bad).toThrow();
    }
  });
});

describe("isProtected", () => {
  it("protects every listed environment by full name and by service segment", () => {
    for (const name of PROTECTED_ENVIRONMENTS) {
      expect(isProtected(name), name).toBe(true);
      expect(isProtected(`Redline Atlas / ${name}`), name).toBe(true);
    }
  });

  // The pruner must not be able to delete the environment it runs in.
  it("protects the prune workflow's own environment", () => {
    expect(PROTECTED_ENVIRONMENTS).toContain("env-prune");
    expect(isProtected("env-prune")).toBe(true);
    expect(selectCandidates(envs("env-prune")).candidates).toEqual([]);
  });

  it("is case-insensitive and honours --keep additions", () => {
    expect(isProtected("GITHUB-PAGES")).toBe(true);
    expect(isProtected("Redline Atlas / redlens-pr-401")).toBe(false);
    expect(isProtected("Redline Atlas / redlens-pr-401", ["Redline Atlas / redlens-pr-401"])).toBe(true);
  });
});

describe("selectCandidates", () => {
  it("only ever considers names that parse as a PR environment", () => {
    const { candidates, keptCount } = selectCandidates(LIVE);
    expect(candidates.map((c) => c.pr).sort((a, b) => a - b)).toEqual([210, 400, 401, 999]);
    expect(keptCount).toBe(LIVE.length - 4);
    // The substring case is kept, not treated as PR 12.
    expect(candidates.some((c) => c.name === "expr-12")).toBe(false);
  });

  it("narrows to one PR with onlyPr, keeping everything else", () => {
    const { candidates, keptCount } = selectCandidates(LIVE, { onlyPr: 401 });
    expect(candidates).toEqual([{ name: "Redline Atlas / redlens-pr-401", pr: 401 }]);
    expect(keptCount).toBe(LIVE.length - 1);
  });

  it("never selects a protected environment even if it would parse", () => {
    // A hypothetical future regex loosening must still not reach these.
    const { candidates } = selectCandidates(envs("production", "CI", "github-pages"));
    expect(candidates).toEqual([]);
  });
});

describe("planPrune", () => {
  it("deletes closed PRs only, keeping open and unknown by default", () => {
    const { candidates } = selectCandidates(LIVE);
    const { open, stale, unknown, doomed } = planPrune(candidates, STATES);
    expect(open.map((c) => c.pr)).toEqual([400]);
    expect(stale.map((c) => c.pr).sort((a, b) => a - b)).toEqual([210, 401]);
    expect(unknown.map((c) => c.pr)).toEqual([999]);
    expect(doomed.map((c) => c.pr).sort((a, b) => a - b)).toEqual([210, 401]);
    expect(doomed.some((c) => c.pr === 400)).toBe(false);
  });

  it("adds the unknowns only when --orphans is set", () => {
    const { candidates } = selectCandidates(LIVE);
    const { doomed } = planPrune(candidates, STATES, { orphans: true });
    expect(doomed.map((c) => c.pr).sort((a, b) => a - b)).toEqual([210, 401, 999]);
    // Still never an open PR.
    expect(doomed.some((c) => c.pr === 400)).toBe(false);
  });
});

describe("looksLikeMissingPrScope", () => {
  // A token with Administration: write but no Pull requests: read 404s on every
  // PR, so every candidate reads "missing" and --orphans would delete the
  // environments of OPEN PRs — including the one running the workflow.
  it("flags an all-404 sweep as a scope problem", () => {
    const { candidates } = selectCandidates(LIVE);
    const all404 = new Map(candidates.map((c) => [c.pr, "missing"]));
    expect(looksLikeMissingPrScope(candidates, all404)).toBe(true);
  });

  it("does not flag a single genuine miss, which is what --pr <gone> looks like", () => {
    const one = [{ name: "Redline Atlas / redlens-pr-999", pr: 999 }];
    expect(looksLikeMissingPrScope(one, new Map([[999, "missing"]]))).toBe(false);
  });

  it("does not flag a sweep where any lookup succeeded", () => {
    const { candidates } = selectCandidates(LIVE);
    expect(looksLikeMissingPrScope(candidates, STATES)).toBe(false);
  });
});
