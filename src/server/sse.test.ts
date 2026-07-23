// SSE client registry. Run under `bun test`. The module installs a real 30s
// heartbeat setInterval at import time; we swap globalThis.setInterval before
// the (first, dynamic) import to capture the callback and its would-be timer
// instead of actually waiting, then invoke it directly to exercise the
// heartbeat + its error-cleanup branch.
import { test, expect } from "bun:test";

let heartbeat: (() => void) | null = null;
let unrefCalled = false;
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = ((fn: () => void, _ms: number) => {
  heartbeat = fn;
  return { unref: () => { unrefCalled = true; } };
}) as unknown as typeof setInterval;

const { registerSSEClient, broadcastAtlasUpdate } = await import("./sse.ts");
globalThis.setInterval = realSetInterval;

test("installs the heartbeat interval with .unref() so it can't keep the process alive", () => {
  expect(heartbeat).not.toBeNull();
  expect(unrefCalled).toBe(true);
});

test("registerSSEClient returns an unregister fn; broadcast reaches only registered clients", () => {
  const receivedA: string[] = [];
  const receivedB: string[] = [];
  const unregisterA = registerSSEClient((c) => receivedA.push(c), () => {});
  const unregisterB = registerSSEClient((c) => receivedB.push(c), () => {});

  broadcastAtlasUpdate("abc123");
  expect(receivedA).toHaveLength(1);
  expect(receivedA[0]).toBe(`event: atlas-update\ndata: ${JSON.stringify({ atlas_sha: "abc123" })}\n\n`);
  expect(receivedB).toHaveLength(1);

  unregisterA();
  broadcastAtlasUpdate("def456");
  expect(receivedA).toHaveLength(1); // unregistered — no second message
  expect(receivedB).toHaveLength(2);

  unregisterB();
});

test("broadcast silently drops a client whose enqueue throws (removing it from the registry)", () => {
  let calls = 0;
  registerSSEClient(() => {
    calls++;
    throw new Error("stream closed");
  }, () => {});
  expect(() => broadcastAtlasUpdate("x")).not.toThrow();
  expect(calls).toBe(1);
  // The throwing client was deleted — a second broadcast doesn't call it again.
  broadcastAtlasUpdate("y");
  expect(calls).toBe(1);
});

test("heartbeat pings every registered client and drops one whose enqueue throws", () => {
  const received: string[] = [];
  const unregister = registerSSEClient((c) => received.push(c), () => {});
  registerSSEClient(() => {
    throw new Error("gone");
  }, () => {});

  expect(() => heartbeat!()).not.toThrow();
  expect(received).toContain(":ping\n\n");

  // The throwing client is now gone; a second tick only touches survivors.
  const before = received.length;
  heartbeat!();
  expect(received.length).toBe(before + 1);
  unregister();
});
