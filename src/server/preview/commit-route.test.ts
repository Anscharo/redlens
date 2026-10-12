// The commit-history stream shell and its per-document filter. The route's
// gating and replay are exercised through handler.test.ts. Run via `bun test`.

import { describe, expect, test } from "bun:test";

import type { PreviewMeta } from "./cache.ts";
import { follow, forDocument, sse, type CommitWireEvent } from "./commit-route.ts";
import { openWalk, walkKey, type CommitStreamEvent, type Send } from "./commit-stream.ts";
import type { WalkPlan } from "./commit-plan.ts";

async function frames(res: Response): Promise<CommitWireEvent[]> {
  const text = await res.text();
  return text.split("\n\n").flatMap((f) => (f.match(/^data: (.+)$/m) ? [JSON.parse(f.match(/^data: (.+)$/m)![1])] : []));
}

describe("commit stream shell", () => {
  test("ends with an error event when the producer rejects", async () => {
    const res = sse({}, () => Promise.reject(new Error("planning exploded")));
    expect(await frames(res)).toEqual([{ type: "error", reason: "failed" }]);
  });

  test("closes after the last event and releases the producer's subscription", async () => {
    let released = 0;
    const res = sse({ "cache-control": "private, no-store" }, async (send) => {
      send({ type: "range", total: 1, walking: 1 });
      send({ type: "done", truncated: false });
      send({ type: "range", total: 9, walking: 9 });
      return () => released++;
    });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await frames(res)).map((e) => e.type)).toEqual(["range", "done"]);
    await Promise.resolve();
    expect(released).toBe(1);
  });

  test("keeps a quiet stream alive with comment frames until the last event", async () => {
    const res = sse({}, async (send) => (setTimeout(() => send({ type: "done", truncated: false }), 30), () => {}), 5);
    const text = await res.text();
    expect(text.startsWith(":\n\n")).toBe(true);
    expect(text.trimEnd().endsWith(`data: ${JSON.stringify({ type: "done", truncated: false })}`)).toBe(true);
  });
});

describe("follow", () => {
  test("two readers arriving while the first plan is made share one walk", async () => {
    const sha = "f".repeat(40);
    const starts: string[] = [];
    let emit: Send = () => {};
    const deps = {
      plan: async () => (await Bun.sleep(5), { sha, base: "repo" } as WalkPlan),
      start: (p: WalkPlan) => void (starts.push(p.sha), (emit = openWalk(walkKey(p.sha, p.base)))),
    };
    const seen: CommitStreamEvent[][] = [[], []];
    const meta = { bases: { auto: "repo", repo: { repo: "o/r", ref: "main", mergeBase: "mb" } } } as unknown as PreviewMeta;
    await Promise.all(seen.map((out, i) => follow(sha, "repo", meta, `ip-${i}`, (ev) => void out.push(ev), deps)));
    expect(starts).toHaveLength(1);
    emit({ type: "done", truncated: false });
    expect(seen).toEqual([[{ type: "done", truncated: false }], [{ type: "done", truncated: false }]]);
  });
});

describe("forDocument", () => {
  test("keeps the commit header and only the asked-for document's rows", () => {
    const commit = { sha: "c", parents: [], date: "d", author: null, message: "m", merge: false, entries: { a: [{ changeType: "added" as const, docNo: "A.1", title: "T" }] } };
    expect(forDocument({ type: "commit", index: 0, commit }, "a")).toMatchObject({ commit: { sha: "c", entries: [{ docNo: "A.1" }] } });
    expect(forDocument({ type: "commit", index: 0, commit }, "b")).toMatchObject({ commit: { entries: [] } });
    expect(forDocument({ type: "done", truncated: true }, "a")).toEqual({ type: "done", truncated: true });
  });
});
