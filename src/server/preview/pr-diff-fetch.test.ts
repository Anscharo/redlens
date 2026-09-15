// pr-diff.ts — diff-base CANDIDATE resolution (sky / repo / auto). Doc-level
// diffing itself (diffSnapshots) is covered in preview.test.ts; this file only
// covers the network shape.
//
// skyCandidate/repoCandidate/pickAuto take an explicit GhClient, so they're
// tested with fake GhClient objects directly (no global fetch stubbing).
// resolveCandidates builds its own GhClients internally via makeGhClient, so
// its one test stubs globalThis.fetch (restored in afterEach) — same pattern
// open-prs.test.ts uses.
import { test, expect, afterEach, beforeEach } from "bun:test";
import { skyCandidate, repoCandidate, pickAuto, resolveCandidates, CompareError, type Candidate } from "./pr-diff.ts";
import { __resetForkPointCacheForTest } from "./fork-point.ts";
import { CANONICAL_REPO, type Resolved } from "./resolve.ts";
import { config } from "../config.ts";

beforeEach(() => {
  __resetForkPointCacheForTest();
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeGh(byPath: Record<string, { ok?: boolean; status?: number; json: any }>): any {
  const calls: string[] = [];
  return {
    calls,
    async fetchJson(p: string) {
      calls.push(p);
      const r = byPath[p];
      if (!r) return { ok: false, status: 404, json: null };
      return { ok: r.ok ?? true, status: r.status ?? 200, json: r.json };
    },
  };
}

function jsonRes(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

// ---------------------------------------------------------------------------
// skyCandidate
// ---------------------------------------------------------------------------

test("skyCandidate public: compares the served atlasCommit against the bare head sha", async () => {
  const canonicalGh = fakeGh({
    "/repos/sky-ecosystem/next-gen-atlas/compare/atlas123...headsha": {
      json: { merge_base_commit: { sha: "mb" }, ahead_by: 1, behind_by: 2 },
    },
  });
  const repoGh = fakeGh({});
  const resolved: Resolved = { repo: "r", sha: "headsha", kind: "branch", ref: "spark" };
  const c = await skyCandidate(resolved, { canonicalGh, repoGh, priv: false, atlasCommit: "atlas123" });
  expect(c).toEqual({ key: "sky", repo: CANONICAL_REPO, ref: "main", mergeBase: "mb", aheadBy: 1, behindBy: 2 });
  expect(canonicalGh.calls).toEqual(["/repos/sky-ecosystem/next-gen-atlas/compare/atlas123...headsha"]);
});

test("skyCandidate public: no atlasCommit falls back to COMPARE_BASE (main)", async () => {
  const canonicalGh = fakeGh({
    "/repos/sky-ecosystem/next-gen-atlas/compare/main...headsha": { json: { merge_base_commit: { sha: "mb" } } },
  });
  const resolved: Resolved = { repo: "r", sha: "headsha", kind: "branch", ref: "spark" };
  const c = await skyCandidate(resolved, { canonicalGh, repoGh: fakeGh({}), priv: false, atlasCommit: undefined });
  expect(c?.mergeBase).toBe("mb");
});

test("skyCandidate public: 404 throws CompareError — load-bearing for the fork shared-history screen", async () => {
  const canonicalGh = fakeGh({});
  const resolved: Resolved = { repo: "r", sha: "gone", kind: "branch", ref: "spark" };
  await expect(skyCandidate(resolved, { canonicalGh, repoGh: fakeGh({}), priv: false, atlasCommit: "atlas123" })).rejects.toBeInstanceOf(
    CompareError,
  );
});

test("skyCandidate private: uses the fork-point commit-list walk, never a cross-repo compare", async () => {
  const repoGh = fakeGh({
    "/repos/priv/repo/commits?sha=headsha&per_page=100&page=1": { json: [{ sha: "headsha" }, { sha: "shared1" }] },
    "/repos/priv/repo/compare/shared1...headsha": { json: { ahead_by: 4 } },
  });
  const canonicalGh = fakeGh({
    "/repos/sky-ecosystem/next-gen-atlas/commits?sha=atlasX&per_page=100&page=1": { json: [{ sha: "shared1" }] },
    "/repos/sky-ecosystem/next-gen-atlas/compare/shared1...atlasX": { json: { ahead_by: 9 } },
  });
  const resolved: Resolved = { repo: "priv/repo", sha: "headsha", kind: "branch", ref: "spark", private: true };
  const c = await skyCandidate(resolved, { canonicalGh, repoGh, priv: true, atlasCommit: "atlasX" });
  expect(c).toEqual({ key: "sky", repo: CANONICAL_REPO, ref: "main", mergeBase: "shared1", aheadBy: 4, behindBy: 9 });
});

test("skyCandidate private: no fork point is null, never a throw", async () => {
  const repoGh = fakeGh({ "/repos/priv/repo/commits?sha=headsha&per_page=100&page=1": { json: [{ sha: "headsha" }] } });
  const canonicalGh = fakeGh({ "/repos/sky-ecosystem/next-gen-atlas/commits?sha=atlasY&per_page=100&page=1": { json: [{ sha: "other" }] } });
  const resolved: Resolved = { repo: "priv/repo", sha: "headsha", kind: "branch", ref: "spark", private: true };
  expect(await skyCandidate(resolved, { canonicalGh, repoGh, priv: true, atlasCommit: "atlasY" })).toBeNull();
});

// ---------------------------------------------------------------------------
// repoCandidate
// ---------------------------------------------------------------------------

test("repoCandidate PR: hits /repos/<prBase.repo>/compare/<ref>...<sha> exactly once, never /pulls", async () => {
  const repoGh = fakeGh({
    "/repos/basehost/repo/compare/release...headsha": { json: { merge_base_commit: { sha: "mb" }, ahead_by: 1, behind_by: 0 } },
  });
  const resolved: Resolved = {
    repo: "headhost/repo",
    sha: "headsha",
    kind: "branch",
    ref: "feature",
    prBase: { repo: "basehost/repo", ref: "release" },
  };
  const c = await repoCandidate(resolved, repoGh);
  expect(c).toEqual({ key: "repo", repo: "basehost/repo", ref: "release", mergeBase: "mb", aheadBy: 1, behindBy: 0 });
  expect(repoGh.calls).toEqual(["/repos/basehost/repo/compare/release...headsha"]);
  expect(repoGh.calls.some((c: string) => c.includes("/pulls"))).toBe(false);
});

test("repoCandidate PR: a canonical pull-N against main still gets a candidate (redundant with sky, harmless)", async () => {
  const repoGh = fakeGh({
    [`/repos/${CANONICAL_REPO}/compare/main...headsha`]: { json: { merge_base_commit: { sha: "mb" } } },
  });
  const resolved: Resolved = {
    repo: CANONICAL_REPO,
    sha: "headsha",
    kind: "pr",
    ref: "pull-1",
    prBase: { repo: CANONICAL_REPO, ref: "main" },
  };
  expect((await repoCandidate(resolved, repoGh))?.mergeBase).toBe("mb");
});

test("repoCandidate branch: skipped when the ref IS the default branch", async () => {
  const repoGh = fakeGh({});
  const resolved: Resolved = { repo: "acme/fork", sha: "s", kind: "branch", ref: "main", defaultBranch: "main" };
  expect(await repoCandidate(resolved, repoGh)).toBeNull();
  expect(repoGh.calls.length).toBe(0);
});

test("repoCandidate branch: skipped for the canonical repo (coincides with sky)", async () => {
  const repoGh = fakeGh({});
  const resolved: Resolved = { repo: CANONICAL_REPO, sha: "s", kind: "branch", ref: "spark", defaultBranch: "main" };
  expect(await repoCandidate(resolved, repoGh)).toBeNull();
  expect(repoGh.calls.length).toBe(0);
});

test("repoCandidate branch: skipped when there is neither prBase nor defaultBranch", async () => {
  const repoGh = fakeGh({});
  const resolved: Resolved = { repo: "acme/fork", sha: "s", kind: "branch", ref: "spark" };
  expect(await repoCandidate(resolved, repoGh)).toBeNull();
  expect(repoGh.calls.length).toBe(0);
});

test("repoCandidate: a failed compare (404) is null, not a throw", async () => {
  const repoGh = fakeGh({});
  const resolved: Resolved = {
    repo: "headhost/repo",
    sha: "s",
    kind: "branch",
    ref: "feature",
    prBase: { repo: "basehost/repo", ref: "release" },
  };
  expect(await repoCandidate(resolved, repoGh)).toBeNull();
});

// ---------------------------------------------------------------------------
// pickAuto
// ---------------------------------------------------------------------------

const skyC: Candidate = { key: "sky", repo: CANONICAL_REPO, ref: "main", mergeBase: "skymb" };
const repoC: Candidate = { key: "repo", repo: "acme/fork", ref: "develop", mergeBase: "repomb" };

test("pickAuto: a PR whose base IS sky main collapses to one sky candidate (no switch, no drift vs main itself)", async () => {
  const resolved: Resolved = { repo: "acme/fork", sha: "s", kind: "pr", ref: "pull-7", prBase: { repo: CANONICAL_REPO, ref: "main" } };
  const skyC: Candidate = { key: "sky", repo: CANONICAL_REPO, ref: "main", mergeBase: "mb", aheadBy: 2, behindBy: 1 };
  const repoC: Candidate = { key: "repo", repo: CANONICAL_REPO, ref: "main", mergeBase: "mb", aheadBy: 2, behindBy: 1 };
  const repoGh = { fetchJson: async () => { throw new Error("no compare expected"); } };
  expect(await pickAuto(resolved, skyC, repoC, repoGh)).toEqual({ auto: "sky", sky: skyC });
  // Sky compare failed (public fork with a network blip) but the repo compare on canonical main worked: its counts stand in.
  expect(await pickAuto(resolved, null, repoC, repoGh)).toEqual({ auto: "sky", sky: { ...repoC, key: "sky" } });
});

test("pickAuto: a network throw from the candidate compare degrades to sky + reason, never rejects", async () => {
  const resolved: Resolved = { repo: "acme/fork", sha: "s", kind: "branch", ref: "feature", defaultBranch: "main" };
  const skyC: Candidate = { key: "sky", repo: CANONICAL_REPO, ref: "main", mergeBase: "a" };
  const repoC: Candidate = { key: "repo", repo: "acme/fork", ref: "main", mergeBase: "b" };
  const repoGh = { fetchJson: async () => { throw new Error("socket hang up"); } };
  expect(await pickAuto(resolved, skyC, repoC, repoGh)).toEqual({ auto: "sky", sky: skyC, repo: repoC, reason: "candidate compare failed" });
});

test("pickAuto: a PR forces repo even with both candidates present — no extra compare", async () => {
  const repoGh = fakeGh({});
  const resolved: Resolved = { repo: "acme/fork", sha: "s", kind: "branch", ref: "feature", prBase: { repo: "acme/fork", ref: "main" } };
  expect(await pickAuto(resolved, skyC, repoC, repoGh)).toEqual({ auto: "repo", sky: skyC, repo: repoC });
  expect(repoGh.calls.length).toBe(0);
});

test("pickAuto: PR with only sky resolved falls back to sky", async () => {
  const resolved: Resolved = { repo: "acme/fork", sha: "s", kind: "branch", ref: "feature", prBase: { repo: "acme/fork", ref: "main" } };
  expect(await pickAuto(resolved, skyC, null, fakeGh({}))).toEqual({ auto: "sky", sky: skyC });
});

test("pickAuto: PR with neither candidate degrades to live-main", async () => {
  const resolved: Resolved = { repo: "acme/fork", sha: "s", kind: "branch", ref: "feature", prBase: { repo: "acme/fork", ref: "main" } };
  expect(await pickAuto(resolved, null, null, fakeGh({}))).toEqual({ auto: "live-main" });
});

test("pickAuto: branch, status ahead -> repo", async () => {
  const repoGh = fakeGh({ "/repos/acme/fork/compare/skymb...repomb": { json: { status: "ahead" } } });
  const resolved: Resolved = { repo: "acme/fork", sha: "s", kind: "branch", ref: "feature" };
  expect(await pickAuto(resolved, skyC, repoC, repoGh)).toEqual({ auto: "repo", sky: skyC, repo: repoC });
});

test("pickAuto: branch, status behind -> sky", async () => {
  const repoGh = fakeGh({ "/repos/acme/fork/compare/skymb...repomb": { json: { status: "behind" } } });
  const resolved: Resolved = { repo: "acme/fork", sha: "s", kind: "branch", ref: "feature" };
  expect(await pickAuto(resolved, skyC, repoC, repoGh)).toEqual({ auto: "sky", sky: skyC, repo: repoC });
});

test("pickAuto: branch, status identical -> collapses to sky only", async () => {
  const repoGh = fakeGh({ "/repos/acme/fork/compare/skymb...repomb": { json: { status: "identical" } } });
  const resolved: Resolved = { repo: "acme/fork", sha: "s", kind: "branch", ref: "feature" };
  expect(await pickAuto(resolved, skyC, repoC, repoGh)).toEqual({ auto: "sky", sky: skyC });
});

test("pickAuto: branch, status diverged -> sky with reason", async () => {
  const repoGh = fakeGh({ "/repos/acme/fork/compare/skymb...repomb": { json: { status: "diverged" } } });
  const resolved: Resolved = { repo: "acme/fork", sha: "s", kind: "branch", ref: "feature" };
  expect(await pickAuto(resolved, skyC, repoC, repoGh)).toEqual({ auto: "sky", sky: skyC, repo: repoC, reason: "candidates diverged" });
});

test("pickAuto: branch, a failed candidate compare -> sky with reason", async () => {
  const repoGh = fakeGh({}); // 404
  const resolved: Resolved = { repo: "acme/fork", sha: "s", kind: "branch", ref: "feature" };
  expect(await pickAuto(resolved, skyC, repoC, repoGh)).toEqual({ auto: "sky", sky: skyC, repo: repoC, reason: "candidate compare failed" });
});

test("pickAuto: branch with only one candidate never calls the compare", async () => {
  const repoGh = fakeGh({});
  const resolved: Resolved = { repo: "acme/fork", sha: "s", kind: "branch", ref: "feature" };
  expect(await pickAuto(resolved, skyC, null, repoGh)).toEqual({ auto: "sky", sky: skyC });
  expect(await pickAuto(resolved, null, repoC, repoGh)).toEqual({ auto: "repo", repo: repoC });
  expect(await pickAuto(resolved, null, null, repoGh)).toEqual({ auto: "live-main" });
  expect(repoGh.calls.length).toBe(0);
});

// ---------------------------------------------------------------------------
// resolveCandidates
// ---------------------------------------------------------------------------

test("resolveCandidates: a CompareError from the public sky compare is caught -> compareOk false", async () => {
  const origToken = config.githubToken;
  config.githubToken = "svc-token";
  try {
    // @ts-expect-error stub
    globalThis.fetch = () => Promise.resolve(jsonRes(null, false, 404));
    const resolved: Resolved = { repo: "r", sha: "gone", kind: "branch", ref: "spark" };
    const result = await resolveCandidates(resolved, { token: "svc-token", priv: false, atlasCommit: "atlasZ" });
    expect(result.compareOk).toBe(false);
    expect(result.sky).toBeUndefined();
    expect(result.auto).toBe("live-main");
  } finally {
    config.githubToken = origToken;
  }
});

test("resolveCandidates: a private preview's null fork point still counts as compareOk true", async () => {
  const origToken = config.githubToken;
  config.githubToken = "svc-token";
  try {
    // Two disjoint commit lists — canonical and the private repo share nothing,
    // so the fork-point walk finds no intersection.
    // @ts-expect-error stub
    globalThis.fetch = (url: string) => {
      const u = String(url);
      if (u.includes("/repos/sky-ecosystem/next-gen-atlas/commits")) return Promise.resolve(jsonRes([{ sha: "sky-only" }], true, 200));
      if (u.includes("/repos/priv/repo/commits")) return Promise.resolve(jsonRes([{ sha: "priv-only" }], true, 200));
      return Promise.resolve(jsonRes(null, false, 404));
    };
    const resolved: Resolved = { repo: "priv/repo", sha: "headsha", kind: "branch", ref: "spark", private: true };
    const result = await resolveCandidates(resolved, { token: "install-token", priv: true, atlasCommit: "atlasW" });
    expect(result.compareOk).toBe(true);
    expect(result.sky).toBeUndefined();
    expect(result.auto).toBe("live-main");
  } finally {
    config.githubToken = origToken;
  }
});
