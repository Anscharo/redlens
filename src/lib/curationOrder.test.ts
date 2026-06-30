// Pure ordering / grouping / auto-select logic for the curation tool.
import { describe, it, expect } from "vitest";
import { orderedCases, commitBounds, adjacentCommit, commitInfo, autoSelectKey, autoLabel } from "./curationOrder";
import type { CurationCase, CurationData } from "./historyCuration";

const kase = (key: string, newerSha: string, subjectOrder: number, extra: Partial<CurationCase> = {}): CurationCase => ({
  key, kind: "tier-3", newerSha, olderSha: "x", subjectKey: key, subjectOrder, autoKey: null, candidates: [], ...extra,
});

// commits are oldest→newest: a, b, c (so newest-first rank is c < b < a; the seed
// commit "mig" is not an HTML commit → ranks before all of them)
const data: CurationData = {
  meta: {},
  commits: [
    { sha: "a", date: "2025-05-01", pr: 1 },
    { sha: "b", date: "2025-05-02", pr: 2 },
    { sha: "c", date: "2025-05-03", pr: 3 },
  ],
  nodes: {},
  cases: [
    kase("kA", "a", 3),
    kase("kB", "b", 0),
    kase("kC1", "c", 2),
    kase("kC2", "c", 1),
    kase("kSeed", "mig", 5, { kind: "seed-close" }),
  ],
};

describe("orderedCases", () => {
  it("orders commit-major (newest first, seed before all) then by document order", () => {
    const keys = orderedCases(data).map((c) => c.key);
    expect(keys).toEqual(["kSeed", "kC2", "kC1", "kB", "kA"]);
  });
  it("filters by kind while preserving the order", () => {
    expect(orderedCases(data, "seed-close").map((c) => c.key)).toEqual(["kSeed"]);
  });
});

describe("commitBounds + adjacentCommit", () => {
  const queue = orderedCases(data); // [kSeed, kC2, kC1, kB, kA]
  it("finds the contiguous run of cases in the same commit", () => {
    expect(commitBounds(queue, 1)).toEqual({ start: 1, end: 3 }); // c-group: kC2,kC1
    expect(commitBounds(queue, 0)).toEqual({ start: 0, end: 1 }); // seed alone
  });
  it("jumps to the first case of the adjacent commit", () => {
    expect(adjacentCommit(queue, 1, -1)).toBe(0); // c-group → seed
    expect(adjacentCommit(queue, 1, 1)).toBe(3); // c-group → b-group
    expect(adjacentCommit(queue, 0, -1)).toBeNull(); // nothing before seed
    expect(adjacentCommit(queue, 4, 1)).toBeNull(); // nothing after the last
  });
});

describe("commitInfo", () => {
  it("labels an HTML commit with its metadata", () => {
    expect(commitInfo(data, "b")).toEqual({ sha: "b", date: "2025-05-02", pr: 2, isSeed: false });
  });
  it("marks the unknown #117 migration commit as the seed boundary", () => {
    expect(commitInfo(data, "mig").isSeed).toBe(true);
  });
});

describe("autoSelectKey", () => {
  const c = kase("k", "c", 0, { candidates: [{ key: "hi", score: 0.97 }, { key: "lo", score: 0.5 }] });
  it("returns the candidate when the LLM picks a >95% match", () => {
    expect(autoSelectKey(c, { chosenKey: "hi", why: "" })).toBe("hi");
  });
  it("returns null when the LLM's pick is below the confidence bar", () => {
    expect(autoSelectKey(c, { chosenKey: "lo", why: "" })).toBeNull();
  });
  it("returns null for 'none' or a missing proposal", () => {
    expect(autoSelectKey(c, { chosenKey: "none", why: "" })).toBeNull();
    expect(autoSelectKey(c, null)).toBeNull();
  });
});

describe("autoLabel", () => {
  it("names each auto-resolution mechanism, with a generic fallback", () => {
    expect(autoLabel("forward-reverse")).toMatch(/forward \+ reverse/);
    expect(autoLabel("llm-90")).toMatch(/90%/);
    expect(autoLabel("llm-95")).toMatch(/95%/);
    expect(autoLabel(undefined)).toBe("Auto-resolved");
  });
});
