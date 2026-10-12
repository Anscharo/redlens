// Planning and running one commit-history walk, with its I/O faked.
// Run via `bun test`.

import { describe, expect, test } from "bun:test";
import fs from "node:fs";

import { makeNodeEntry, type GitSnapshot } from "../../../scripts/lib/atlas-git-parse.ts";
import type { PreviewMeta } from "./cache.ts";
import type { CommitHistoryFile } from "./commit-cache.ts";
import { runWalk, type WalkDeps } from "./commit-history.ts";
import { planWalk, type WalkPlan } from "./commit-plan.ts";
import type { CommitStreamEvent } from "./commit-stream.ts";
import type { CommitRange } from "./commit-range.ts";

const snap = (body: string): GitSnapshot => new Map([["a", makeNodeEntry("A.1", "T", "Core", body, "content/A.md")]]);
const SNAPS: Record<string, GitSnapshot> = { mb: snap("0"), c1: snap("1"), c2: snap("2") };
const RANGE: CommitRange = {
  total: 2,
  commits: [
    { sha: "c2", parents: ["c1"], date: "d", author: "x", message: "two" },
    { sha: "c1", parents: ["mb"], date: "d", author: "x", message: "one" },
  ],
};
const PLAN: WalkPlan = { sha: "c2", base: "repo", mergeBase: "mb", fetchRepo: "o/r", compareRepo: "o/r", fetchToken: null, gh: { fetchJson: async () => ({ ok: false, status: 0, json: null }) } };

function deps(over: Partial<WalkDeps> = {}) {
  const written: CommitHistoryFile[] = [];
  const fetched: { depth: number; gitdir: string }[] = [];
  const d: WalkDeps = {
    commitRange: async () => RANGE,
    fetchCommits: async (o) => void fetched.push({ depth: o.depth, gitdir: o.gitdir }),
    loadSnapshot: () => async (sha) => SNAPS[sha],
    writeCache: (_sha, f) => void written.push(f),
    maxCommits: () => 100,
    timeoutMs: () => 10_000,
    ...over,
  };
  return { d, written, fetched };
}

async function run(over: Partial<WalkDeps> = {}) {
  const t = deps(over);
  const events: CommitStreamEvent[] = [];
  await runWalk(PLAN, (ev) => void events.push(ev), t.d);
  return { ...t, events, types: events.map((e) => e.type) };
}

describe("runWalk", () => {
  test("range, then one event per commit newest first, then done; the whole walk is kept", async () => {
    const { types, events, written, fetched } = await run();
    expect(types).toEqual(["range", "commit", "commit", "done"]);
    expect(events[1]).toMatchObject({ index: 0, commit: { sha: "c2" } });
    expect(written[0]).toMatchObject({ base: "repo", mergeBase: "mb", head: "c2", total: 2, truncated: false });
    expect(written[0].commits.map((c) => c.sha)).toEqual(["c2", "c1"]);
    expect(fetched[0].depth).toBe(3);
  });

  test("a range wider than the cap is reported truncated", async () => {
    const { events } = await run({ commitRange: async () => ({ ...RANGE, total: 250 }) });
    expect(events.at(-1)).toEqual({ type: "done", truncated: true });
  });

  test("an empty branch fetches nothing", async () => {
    const { types, fetched } = await run({ commitRange: async () => ({ total: 0, commits: [] }) });
    expect(types).toEqual(["range", "done"]);
    expect(fetched).toEqual([]);
  });

  test("each failure is one named error event, and nothing is kept", async () => {
    const cases: [Partial<WalkDeps>, string][] = [
      [{ commitRange: async () => null }, "range-failed"],
      [{ fetchCommits: async () => Promise.reject(new Error("401")) }, "fetch-failed"],
      [{ fetchCommits: () => new Promise(() => {}), timeoutMs: () => 20 }, "timeout"],
      [{ loadSnapshot: () => async () => ({}) as never }, "failed"],
    ];
    for (const [over, reason] of cases) {
      const { events, written } = await run(over);
      expect(events.at(-1)).toEqual({ type: "error", reason } as CommitStreamEvent);
      expect(written).toEqual([]);
    }
  });

  test("a fetch past the deadline is aborted, and its directory goes once it stops", async () => {
    let signal: AbortSignal | undefined;
    let gitdir = "";
    let stop = () => {};
    const stopped = new Promise<void>((r) => (stop = r));
    const fetchCommits: WalkDeps["fetchCommits"] = (o) => {
      signal = o.signal;
      gitdir = o.gitdir;
      return new Promise((_, reject) => o.signal!.addEventListener("abort", () => setTimeout(() => (reject(new Error("aborted")), stop()), 10)));
    };
    const { events } = await run({ fetchCommits, timeoutMs: () => 20 });
    expect(events.at(-1)).toEqual({ type: "error", reason: "timeout" });
    expect(signal!.aborted).toBe(true);
    expect(fs.existsSync(gitdir)).toBe(true);
    await stopped;
    await Bun.sleep(0);
    expect(fs.existsSync(gitdir)).toBe(false);
  });

  test("failing to keep a finished walk still finishes it", async () => {
    const { events } = await run({ writeCache: () => { throw new Error("bundle evicted"); } });
    expect(events.at(-1)).toEqual({ type: "done", truncated: false });
  });
});

describe("planWalk", () => {
  const meta = (over: Partial<PreviewMeta> = {}): PreviewMeta =>
    ({ sha: "h", repo: "o/head", ref: "b", kind: "branch", resolvedAt: "t", docCount: 1, buildMs: 1, ...over }) as PreviewMeta;
  const bases = { auto: "repo" as const, repo: { repo: "o/base", ref: "main", mergeBase: "mb" }, sky: { repo: "sky/nga", ref: "main", mergeBase: "mb2" } };

  test("no merge base (a live-main degrade) means nothing to walk", async () => {
    expect(await planWalk("h", "repo", meta())).toBeNull();
    expect(await planWalk("h", "sky", meta({ bases: { auto: "live-main" } }))).toBeNull();
  });

  test("a public bundle fetches anonymously from its head repo and compares in the base's repo", async () => {
    const p = (await planWalk("h", "repo", meta({ bases }), async () => "never"))!;
    expect(p).toMatchObject({ mergeBase: "mb", fetchRepo: "o/head", compareRepo: "o/base", fetchToken: null });
  });

  test("a private bundle fetches with the head repo's installation token", async () => {
    const asked: string[] = [];
    const token = async (repo: string) => (asked.push(repo), `tok:${repo}`);
    const p = (await planWalk("h", "repo", meta({ bases, private: true }), token))!;
    expect(p.fetchToken).toBe("tok:o/head");
    expect(asked).toEqual(["o/base", "o/head"]);
  });

  test("a private bundle with no installation token has nothing to fetch with", async () => {
    expect(await planWalk("h", "repo", meta({ bases, private: true }), async () => null)).toBeNull();
  });
});
