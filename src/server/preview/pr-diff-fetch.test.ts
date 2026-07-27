// fetchPreviewFiles + the PR-files / compare-with-cap-recovery paths of
// pr-diff.ts. pathToDocNo/mapChangedDocs (pure) are covered in preview.test.ts.
// Stubs globalThis.fetch (same pattern as open-prs.test.ts), restored in afterAll.
import { test, expect, afterAll } from "bun:test";
import { fetchPreviewFiles, CompareError } from "./pr-diff.ts";
import type { Resolved } from "./resolve.ts";

const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

function jsonRes(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

test("fetchPreviewFiles: PR kind paginates /pulls/{n}/files", async () => {
  const calls: string[] = [];
  const page1 = Array.from({ length: 100 }, (_, i) => ({ filename: `content/A/${i}/document.md`, status: "modified", patch: "p" }));
  const page2 = [{ filename: "content/A/999/document.md", status: "added" }];
  // @ts-expect-error stub
  globalThis.fetch = (url: string) => {
    calls.push(String(url));
    if (String(url).includes("page=2")) return Promise.resolve(jsonRes(page2));
    return Promise.resolve(jsonRes(page1));
  };
  const resolved: Resolved = { repo: "r", sha: "s", kind: "pr", ref: "pull-1", pr: { number: 1, title: "t", author: "a", state: "open" } };
  const result = await fetchPreviewFiles(resolved, "tok");
  expect(result.files).toHaveLength(101);
  expect(calls.some((c) => c.includes("/pulls/1/files"))).toBe(true);
  expect(calls.length).toBe(2); // stopped after a short page
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
