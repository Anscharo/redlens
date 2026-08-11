// fetchPreviewFiles — the GitHub round-trips that supply a preview's merge base
// and fork banner counts. Doc-level diffing itself (diffSnapshots) is covered in
// preview.test.ts; this file only covers the network shape.
//
// Stubs globalThis.fetch (same pattern as open-prs.test.ts), restored in afterEach.
import { test, expect, afterEach } from "bun:test";
import { fetchPreviewFiles, CompareError } from "./pr-diff.ts";
import type { Resolved } from "./resolve.ts";

// Restored after EVERY test, not just at the end of the file: today each test
// installs its own stub first, but a future test that forgets would silently
// inherit the previous one.
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonRes(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

test("PR kind resolves the merge base against the PR's OWN base branch", async () => {
  const calls: string[] = [];
  // @ts-expect-error stub
  globalThis.fetch = (url: string) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("/compare/")) return Promise.resolve(jsonRes({ merge_base_commit: { sha: "mbsha" } }));
    return Promise.resolve(jsonRes({ base: { ref: "release" } }));
  };
  const resolved: Resolved = { repo: "r", sha: "s", kind: "pr", ref: "pull-1", pr: { number: 1, title: "t", author: "a", state: "open" } };
  const result = await fetchPreviewFiles(resolved, "tok");

  expect(result.mergeBase).toBe("mbsha");
  // A PR targeting a release branch must not be diffed against main's tip.
  expect(calls.some((c) => c.includes("/compare/release...s"))).toBe(true);
  // No file listing: nothing consumes one, and it cost up to 5,000 paginated
  // files with patch bodies per preview.
  expect(calls.some((c) => c.includes("/files"))).toBe(false);
  expect(calls.length).toBe(2);
});

test("PR kind: an unresolvable merge base is undefined, not an error", async () => {
  // build.ts then skips diff.json rather than diffing against a guess, and the
  // reader falls back to the serve-time vs-main diff.
  // @ts-expect-error stub
  globalThis.fetch = (url: string) =>
    String(url).includes("/compare/")
      ? Promise.resolve(jsonRes(null, false, 404))
      : Promise.resolve(jsonRes({ base: { ref: "main" } }));
  const resolved: Resolved = { repo: "r", sha: "s", kind: "pr", ref: "pull-9", pr: { number: 9, title: "t", author: "a", state: "open" } };
  expect((await fetchPreviewFiles(resolved, "tok")).mergeBase).toBeUndefined();
});

test("branch kind hits the compare endpoint for merge base + ahead/behind", async () => {
  const calls: string[] = [];
  // @ts-expect-error stub
  globalThis.fetch = (url: string) => {
    calls.push(String(url));
    expect(String(url)).toContain("/compare/main...deadbeef");
    return Promise.resolve(jsonRes({ ahead_by: 1, behind_by: 0, merge_base_commit: { sha: "mb" } }));
  };
  const resolved: Resolved = { repo: "r", sha: "deadbeef", kind: "branch", ref: "spark" };
  const result = await fetchPreviewFiles(resolved, "tok");

  expect(result.aheadBy).toBe(1);
  expect(result.behindBy).toBe(0);
  expect(result.mergeBase).toBe("mb");
  expect(calls.length).toBe(1); // one call — no per-commit union recovery
});

test("compare 404/failure → CompareError", async () => {
  // Load-bearing for forks: build.ts turns this into "not-derived". A fork with
  // no common ancestor is not a derivative of the atlas.
  // @ts-expect-error stub
  globalThis.fetch = () => Promise.resolve(jsonRes(null, false, 404));
  const resolved: Resolved = { repo: "r", sha: "gone", kind: "branch", ref: "spark" };
  await expect(fetchPreviewFiles(resolved, "tok")).rejects.toBeInstanceOf(CompareError);
});
