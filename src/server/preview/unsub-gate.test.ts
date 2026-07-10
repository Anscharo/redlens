// Regression test for the SSE unsubscribe race in eventsResponse (handler.ts):
// a client cancel arriving before drive() resolves used to hit the stale
// initial noop, so the real unsubscribe from subscribeBuild() never ran and
// the dead `send` stayed in Inflight.subscribers until the build ended.
// makeUnsubGate() is the extracted fix; exercised directly here since driving
// the real SSE stream needs a live build (network + subprocess).
import { test, expect } from "bun:test";
import { makeUnsubGate } from "./handler.ts";

test("cancel before resolve still invokes the real unsubscribe once it arrives", () => {
  const gate = makeUnsubGate();
  gate.cancel(); // client disconnects while drive() is still in flight
  let calls = 0;
  gate.resolve(() => calls++); // drive() finally resolves with the real unsub
  expect(calls).toBe(1);
});

test("resolve then cancel invokes the real unsubscribe once", () => {
  const gate = makeUnsubGate();
  let calls = 0;
  gate.resolve(() => calls++);
  expect(calls).toBe(0); // not called just by resolving
  gate.cancel();
  expect(calls).toBe(1);
});

test("double cancel does not double-invoke the unsubscribe", () => {
  const gate = makeUnsubGate();
  let calls = 0;
  gate.resolve(() => calls++);
  gate.cancel();
  gate.cancel();
  expect(calls).toBe(1);
});

test("resolve after an already-cancelled gate still fires exactly once, never twice on a later cancel", () => {
  const gate = makeUnsubGate();
  let calls = 0;
  gate.cancel();
  gate.resolve(() => calls++);
  gate.cancel(); // a second cancel (e.g. defensive call from close()) must be a noop
  expect(calls).toBe(1);
});
