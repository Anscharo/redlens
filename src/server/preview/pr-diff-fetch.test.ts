// pr-diff.ts — diff-base CANDIDATE resolution (sky / repo / auto). Doc-level
// diffing itself (diffSnapshots) is covered in preview.test.ts; this file only
// covers the network shape.
//
// skyCandidate/repoCandidate/pickAuto take an explicit GhClient, so they're
// tested with fake GhClient objects directly (no global fetch stubbing).
// resolveCandidates builds its own GhClients internally via makeGhClient, so
// its one test stubs globalThis.fetch (restored in afterEach) — same pattern
// open-prs.test.ts uses.
import { test, expect, afterEach } from "bun:test";
import { skyCandidate, repoCandidate, pickAuto, resolveCandidates, CompareError, type Candidate } from "./pr-diff.ts";
import { CANONICAL_REPO, type Resolved } from "./resolve.ts";
import { config } from "../config.ts";

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

test("skyCandidate private: always null, and makes no GitHub call — a private preview never searches for an nga-main ancestor", async () => {
  // Wired so a commit-list walk WOULD find a shared sha if one were attempted.
  // nga main is squash-merged: a mirror that takes it by content shares no
  // commit SHAs (or only its original import), so that "ancestor" was absent or
  // ancient and redlined the repo's whole history as the preview's change.
  const repoGh = fakeGh({
    "/repos/priv/repo/commits?sha=headsha&per_page=100&page=1": { json: [{ sha: "headsha" }, { sha: "shared1" }] },
    "/repos/priv/repo/compare/shared1...headsha": { json: { ahead_by: 4 } },
  });
  const canonicalGh = fakeGh({
    "/repos/sky-ecosystem/next-gen-atlas/commits?sha=atlasX&per_page=100&page=1": { json: [{ sha: "shared1" }] },
    "/repos/sky-ecosystem/next-gen-atlas/compare/shared1...atlasX": { json: { ahead_by: 9 } },
  });
  const resolved: Resolved = { repo: "priv/repo", sha: "headsha", kind: "branch", ref: "spark", private: true };
  expect(await skyCandidate(resolved, { canonicalGh, repoGh, priv: true, atlasCommit: "atlasX" })).toBeNull();
  expect(repoGh.calls).toEqual([]);
  expect(canonicalGh.calls).toEqual([]);
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

test("private PR without Pulls:read (ref pull-N, no prBase): the default branch is the repo candidate, and auto picks it", async () => {
  // The shape resolvePrivateBranch hands back from the Contents-only fallback.
  // The repo's own main carries work sky main doesn't, so its merge base with
  // the head sits AHEAD of the sky fork point — auto must land on `repo`, or
  // the redline counts all of that main's work as this PR's.
  const resolved: Resolved = { repo: "acme/secret-atlas", sha: "headsha", kind: "branch", ref: "pull-7", defaultBranch: "main", private: true };
  const repoGh = fakeGh({
    "/repos/acme/secret-atlas/compare/main...headsha": { json: { merge_base_commit: { sha: "mainmb" }, ahead_by: 3, behind_by: 12 } },
    // What a PR branch that pulled a newer sky main than the repo's own main
    // would answer. It must never be asked: a PR is forced onto `repo`, the
    // same as one with a declared base, or this status would pick `sky`.
    "/repos/acme/secret-atlas/compare/forkpoint...mainmb": { json: { status: "diverged" } },
  });
  const repo = await repoCandidate(resolved, repoGh);
  expect(repo).toEqual({ key: "repo", repo: "acme/secret-atlas", ref: "main", mergeBase: "mainmb", aheadBy: 3, behindBy: 12 });
  const sky: Candidate = { key: "sky", repo: CANONICAL_REPO, ref: "main", mergeBase: "forkpoint" };
  const picked = await pickAuto(resolved, sky, repo, repoGh);
  expect(picked).toMatchObject({ auto: "repo", sky, repo });
  expect(picked.reason).toBeUndefined();
  expect(repoGh.calls).toEqual(["/repos/acme/secret-atlas/compare/main...headsha"]); // no candidate compare
  // A mirror that shares no commit SHAs with sky has no fork point at all —
  // the repo candidate alone still wins, instead of the live-main degrade.
  expect((await pickAuto(resolved, null, repo, repoGh)).auto).toBe("repo");
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

test("pickAuto: a PR whose own base did not resolve goes to live nga main — NEVER the nga-main fork point, even when one resolved", async () => {
  // The fork point is what the REPO shares with nga main, not what the PR
  // changes: on a repo carrying its own unpublished work it counts all of that
  // work as this PR's. A declared base and the pull-N stand-in behave alike.
  const declared: Resolved = { repo: "acme/fork", sha: "s", kind: "branch", ref: "feature", prBase: { repo: "acme/fork", ref: "main" } };
  const fallback: Resolved = { repo: "acme/fork", sha: "s", kind: "branch", ref: "pull-7", defaultBranch: "main" };
  const repoGh = fakeGh({});
  expect(await pickAuto(declared, skyC, null, repoGh)).toEqual({ auto: "live-main", reason: "PR base did not resolve" });
  expect(await pickAuto(declared, null, null, repoGh)).toEqual({ auto: "live-main", reason: "PR base did not resolve" });
  expect(await pickAuto(fallback, skyC, null, repoGh)).toEqual({ auto: "live-main", reason: "PR base unreadable and no default branch resolved" });
  expect(repoGh.calls.length).toBe(0);
});

test("pickAuto: a PR declared against nga main whose own compare failed uses the canonical compare — it is the SAME base, not a fork point", async () => {
  // pull-256's shape: ~390 docs against live main, the real 53 against the
  // merge base. Losing that to a transient failure of the redundant repo-side
  // compare would be a regression, and the sky candidate IS this PR's base.
  const resolved: Resolved = { repo: "acme/fork", sha: "s", kind: "pr", ref: "pull-256", prBase: { repo: CANONICAL_REPO, ref: "main" } };
  expect(await pickAuto(resolved, skyC, null, fakeGh({}))).toEqual({ auto: "sky", sky: skyC });
  // …but only for nga main: a PR against another canonical branch has no such twin.
  const develop: Resolved = { ...resolved, prBase: { repo: CANONICAL_REPO, ref: "develop" } };
  expect(await pickAuto(develop, skyC, null, fakeGh({}))).toEqual({ auto: "live-main", reason: "PR base did not resolve" });
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

test("resolveCandidates: a private preview has no sky candidate, which still counts as compareOk true — and no commit list is ever walked", async () => {
  const origToken = config.githubToken;
  config.githubToken = "svc-token";
  try {
    const fetched: string[] = [];
    // @ts-expect-error stub
    globalThis.fetch = (url: string) => {
      fetched.push(String(url));
      return Promise.resolve(jsonRes(null, false, 404));
    };
    const resolved: Resolved = { repo: "priv/repo", sha: "headsha", kind: "branch", ref: "spark", private: true };
    const result = await resolveCandidates(resolved, { token: "install-token", priv: true, atlasCommit: "atlasW" });
    expect(result.compareOk).toBe(true);
    expect(result.sky).toBeUndefined();
    expect(result.auto).toBe("live-main");
    expect(fetched.some((u) => u.includes("/commits"))).toBe(false);
  } finally {
    config.githubToken = origToken;
  }
});
