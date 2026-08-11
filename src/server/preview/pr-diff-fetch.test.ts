// fetchPreviewFiles + the PR-files / compare-with-cap-recovery paths of
// pr-diff.ts. The doc-level diff itself (diffSnapshots, pure) lives in
// preview.test.ts — this file only covers the GitHub round-trips.
// Stubs globalThis.fetch (same pattern as open-prs.test.ts).
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

test("fetchPreviewFiles: PR kind paginates /pulls/{n}/files and resolves the merge base", async () => {
  const calls: string[] = [];
  const page1 = Array.from({ length: 100 }, (_, i) => ({ filename: `content/A/${i}/document.md`, status: "modified", patch: "p" }));
  const page2 = [{ filename: "content/A/999/document.md", status: "added" }];
  // @ts-expect-error stub
  globalThis.fetch = (url: string) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("/compare/")) return Promise.resolve(jsonRes({ merge_base_commit: { sha: "mbsha" } }));
    if (u.includes("/pulls/1?") || u.endsWith("/pulls/1")) return Promise.resolve(jsonRes({ base: { ref: "release" } }));
    if (u.includes("page=2")) return Promise.resolve(jsonRes(page2));
    return Promise.resolve(jsonRes(page1));
  };
  const resolved: Resolved = { repo: "r", sha: "s", kind: "pr", ref: "pull-1", pr: { number: 1, title: "t", author: "a", state: "open" } };
  const result = await fetchPreviewFiles(resolved, "tok");
  expect(result.files).toHaveLength(101);
  expect(calls.some((c) => c.includes("/pulls/1/files"))).toBe(true);
  expect(calls.filter((c) => c.includes("/files")).length).toBe(2); // stopped after a short page
  // The merge base is taken against the PR's OWN base branch, not main — a PR
  // targeting a release branch must not be diffed against main's tip.
  expect(result.mergeBase).toBe("mbsha");
  expect(calls.some((c) => c.includes("/compare/release...s"))).toBe(true);
});

test("fetchPreviewFiles: PR kind still returns files when the merge base can't be resolved", async () => {
  // No merge base → build.ts skips diff.json rather than diffing against a
  // guess; the files themselves must still come back for the fork screen.
  // @ts-expect-error stub
  globalThis.fetch = (url: string) => {
    if (String(url).includes("/compare/")) return Promise.resolve(jsonRes(null, false, 404));
    if (String(url).includes("/files")) return Promise.resolve(jsonRes([{ filename: "content/A/1/document.md", status: "modified" }]));
    return Promise.resolve(jsonRes({ base: { ref: "main" } }));
  };
  const resolved: Resolved = { repo: "r", sha: "s", kind: "pr", ref: "pull-9", pr: { number: 9, title: "t", author: "a", state: "open" } };
  const result = await fetchPreviewFiles(resolved, "tok");
  expect(result.files).toHaveLength(1);
  expect(result.mergeBase).toBeUndefined();
});

test("fetchPreviewFiles: PR kind stops on a non-ok response", async () => {
  // @ts-expect-error stub
  globalThis.fetch = () => Promise.resolve(jsonRes(null, false, 500));
  const resolved: Resolved = { repo: "r", sha: "s", kind: "pr", ref: "pull-2", pr: { number: 2, title: "t", author: "a", state: "open" } };
  const result = await fetchPreviewFiles(resolved, "tok");
  expect(result.files).toEqual([]);
});

test("fetchPreviewFiles: branch kind hits the compare endpoint, under the cap", async () => {
  // @ts-expect-error stub
  globalThis.fetch = (url: string) => {
    expect(String(url)).toContain("/compare/main...deadbeef");
    return Promise.resolve(
      jsonRes({
        files: [{ filename: "content/A/1/document.md", status: "modified", patch: "p" }],
        ahead_by: 1,
        behind_by: 0,
      }),
    );
  };
  const resolved: Resolved = { repo: "r", sha: "deadbeef", kind: "branch", ref: "spark" };
  const result = await fetchPreviewFiles(resolved, "tok");
  expect(result.files).toHaveLength(1);
  expect(result.aheadBy).toBe(1);
  expect(result.behindBy).toBe(0);
  expect(result.truncated).toBeUndefined();
});

test("fetchPreviewFiles: compare 404/failure → CompareError", async () => {
  // @ts-expect-error stub
  globalThis.fetch = () => Promise.resolve(jsonRes(null, false, 404));
  const resolved: Resolved = { repo: "r", sha: "gone", kind: "branch", ref: "spark" };
  await expect(fetchPreviewFiles(resolved, "tok")).rejects.toBeInstanceOf(CompareError);
});

test("fetchPreviewFiles: compare cap hit → recovers via per-commit union, keeps merge-base patches", async () => {
  const compareFiles = Array.from({ length: 300 }, (_, i) => ({
    filename: `content/A/${i}/document.md`,
    status: "modified",
    patch: i === 0 ? "graft-me" : undefined,
  }));
  const commits = [{ sha: "c1" }, { sha: "c2" }];
  const commitFilesByC: Record<string, any[]> = {
    c1: [
      { filename: "content/A/0/document.md", status: "modified" }, // exists in compare → gets patch grafted
      { filename: "content/A/extra/document.md", status: "added" }, // recovered beyond the 300 cap
    ],
    c2: [],
  };
  // @ts-expect-error stub
  globalThis.fetch = (url: string) => {
    const u = String(url);
    if (u.includes("/compare/")) return Promise.resolve(jsonRes({ files: compareFiles, ahead_by: 2, behind_by: 0, commits }));
    const m = u.match(/\/commits\/(\w+)\?/);
    const sha = m ? m[1]! : "";
    return Promise.resolve(jsonRes({ files: commitFilesByC[sha] ?? [] }));
  };
  const resolved: Resolved = { repo: "r", sha: "big", kind: "branch", ref: "spark" };
  const result = await fetchPreviewFiles(resolved, "tok");
  // union of compare (300) + extra recovered file, minus none removed
  expect(result.files.length).toBe(301);
  const grafted = result.files.find((f) => f.filename === "content/A/0/document.md");
  expect(grafted?.patch).toBe("graft-me");
  const extra = result.files.find((f) => f.filename === "content/A/extra/document.md");
  expect(extra).toBeDefined();
  expect(result.aheadBy).toBe(2);
});
