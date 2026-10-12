// The branch's commit list from compare: newest first, capped, across pages.
// Run via `bun test`.

import { describe, expect, test } from "bun:test";

import { commitRange } from "./commit-range.ts";
import type { GhClient } from "./resolve.ts";

/** A compare API over `total` linear commits c1…cN (oldest first), paged by 100. */
function fakeCompare(total: number, fail = false): GhClient & { pages: number[] } {
  const pages: number[] = [];
  return {
    pages,
    async fetchJson(p: string) {
      const n = Number(new URL(`https://x${p}`).searchParams.get("page"));
      pages.push(n);
      if (fail) return { ok: false, status: 404, json: null };
      const from = (n - 1) * 100 + 1;
      const commits = Array.from({ length: Math.max(0, Math.min(100, total - from + 1)) }, (_, i) => ({
        sha: `c${from + i}`,
        parents: [{ sha: `c${from + i - 1}` }],
        author: i % 2 ? null : { login: "octo" },
        commit: { author: { name: "Git Name", date: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z` }, message: `subject ${from + i}\n\nbody` },
      }));
      return { ok: true, status: 200, json: { total_commits: total, commits } };
    },
  };
}

describe("commitRange", () => {
  test("a short branch is one page, newest first, with the subject line only", async () => {
    const gh = fakeCompare(3);
    const r = await commitRange(gh, "o/r", "mb", "head", 100);
    expect(r!.total).toBe(3);
    expect(r!.commits.map((c) => c.sha)).toEqual(["c3", "c2", "c1"]);
    expect(r!.commits[0]).toMatchObject({ parents: ["c2"], author: "octo", message: "subject 3" });
    expect(r!.commits[1].author).toBe("Git Name");
    expect(gh.pages).toEqual([1]);
  });

  test("a long branch reads only the pages holding its newest `cap` commits", async () => {
    const gh = fakeCompare(250);
    const r = await commitRange(gh, "o/r", "mb", "head", 100);
    expect(r!.total).toBe(250);
    expect(r!.commits).toHaveLength(100);
    expect(r!.commits[0].sha).toBe("c250");
    expect(r!.commits.at(-1)!.sha).toBe("c151");
    expect(gh.pages).toEqual([1, 2, 3]);
  });

  test("the cap applies to a one-page branch too", async () => {
    const r = await commitRange(fakeCompare(40), "o/r", "mb", "head", 10);
    expect(r!.commits.map((c) => c.sha)).toEqual(Array.from({ length: 10 }, (_, i) => `c${40 - i}`));
  });

  test("a failed compare is null", async () => {
    expect(await commitRange(fakeCompare(5, true), "o/r", "mb", "head", 100)).toBeNull();
  });
});
