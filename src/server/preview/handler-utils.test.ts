// Tests for utility functions in handler.ts
import { test, expect } from "bun:test";

test("makeUnsubGate: resolve before cancel calls unsub exactly once", async () => {
  const { makeUnsubGate } = await import("./handler.ts");
  const gate = makeUnsubGate();

  let callCount = 0;
  gate.resolve(() => {
    callCount++;
  });
  gate.cancel();
  gate.cancel();
  gate.cancel();

  expect(callCount).toBe(1);
});

test("makeUnsubGate: cancel before resolve calls unsub exactly once", async () => {
  const { makeUnsubGate } = await import("./handler.ts");
  const gate = makeUnsubGate();

  let callCount = 0;
  gate.cancel();
  gate.resolve(() => {
    callCount++;
  });

  expect(callCount).toBe(1);
});

test("diffCache: key structure for preview vs main diff", async () => {
  const { diffCache } = await import("./handler.ts");

  // Clear cache for test
  diffCache.clear();

  const sha1 = "a".repeat(40);
  const mainSha = "b".repeat(40);
  const key = `${sha1}:${mainSha}`;

  diffCache.set(key, { added: ["id1", "id2"], changed: ["id3"] });

  expect(diffCache.get(key)).toEqual({ added: ["id1", "id2"], changed: ["id3"] });
  expect(diffCache.size).toBe(1);
});

test("diffCache can store and retrieve entries", async () => {
  const { diffCache, DIFF_CACHE_MAX } = await import("./handler.ts");

  diffCache.clear();

  // Add a few entries
  for (let i = 0; i < 10; i++) {
    const key = `${i}:main`;
    diffCache.set(key, { added: [`id${i}`], changed: [] });
  }

  expect(diffCache.size).toBe(10);
  expect(diffCache.get("0:main")).toEqual({ added: ["id0"], changed: [] });
});
