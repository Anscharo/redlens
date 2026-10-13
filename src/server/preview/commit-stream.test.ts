// Joining a running commit-history walk. Run via `bun test`.

import { describe, expect, test } from "bun:test";

import { joinWalk, openWalk, runningWalks, type CommitStreamEvent } from "./commit-stream.ts";

describe("commit stream", () => {
  test("a joiner gets everything so far, then the live tail; the last event closes the walk", () => {
    const emit = openWalk("k1");
    emit({ type: "range", total: 2, walking: 2 });
    const seen: CommitStreamEvent[] = [];
    const unsub = joinWalk("k1", (ev) => seen.push(ev));
    expect(unsub).not.toBeNull();
    emit({ type: "fetching", loaded: 1 });
    emit({ type: "done", truncated: false });
    expect(seen.map((e) => e.type)).toEqual(["range", "fetching", "done"]);
    expect(runningWalks()).not.toContain("k1");
    expect(joinWalk("k1", () => {})).toBeNull();
  });

  test("an unsubscribed reader hears nothing more, and a throwing one does not stop the rest", () => {
    const emit = openWalk("k2");
    const a: string[] = [];
    const b: string[] = [];
    const unsubA = joinWalk("k2", (ev) => a.push(ev.type))!;
    joinWalk("k2", () => {
      throw new Error("gone");
    });
    joinWalk("k2", (ev) => b.push(ev.type));
    emit({ type: "range", total: 1, walking: 1 });
    unsubA();
    emit({ type: "error", reason: "timeout" });
    expect(a).toEqual(["range"]);
    expect(b).toEqual(["range", "error"]);
  });
});
