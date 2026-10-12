// The commit-history stream shell and its per-document filter. The route's
// gating and replay are exercised through handler.test.ts. Run via `bun test`.

import { describe, expect, test } from "bun:test";

import { forDocument, sse, type CommitWireEvent } from "./commit-route.ts";

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
});

describe("forDocument", () => {
  test("keeps the commit header and only the asked-for document's rows", () => {
    const commit = { sha: "c", parents: [], date: "d", author: null, message: "m", merge: false, entries: { a: [{ changeType: "added" as const, docNo: "A.1", title: "T" }] } };
    expect(forDocument({ type: "commit", index: 0, commit }, "a")).toMatchObject({ commit: { sha: "c", entries: [{ docNo: "A.1" }] } });
    expect(forDocument({ type: "commit", index: 0, commit }, "b")).toMatchObject({ commit: { entries: [] } });
    expect(forDocument({ type: "done", truncated: true }, "a")).toEqual({ type: "done", truncated: true });
  });
});
