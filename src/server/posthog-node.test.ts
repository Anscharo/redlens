// Real posthog-node.ts unit tests. mcp.test.ts registers a COMPLETE
// mock.module("./posthog-node.ts", ...) that persists globally for the rest of
// the process — a cache-busting query string (`?realposthog=N`) gets a fresh,
// real module instance regardless of load order (same trick as db.test.ts /
// config.test.ts). POSTHOG_HOST is pointed at an unroutable local port so any
// background flush the SDK attempts fails fast/silently instead of hitting the
// network; shutdownPosthog() is awaited at the end of the "enabled" tests to
// flush + stop the SDK's internal timers so bun test can exit cleanly.
import { test, expect, afterEach } from "bun:test";

const ORIG_KEY = process.env.POSTHOG_KEY;
const ORIG_HOST = process.env.POSTHOG_HOST;

afterEach(() => {
  if (ORIG_KEY === undefined) delete process.env.POSTHOG_KEY;
  else process.env.POSTHOG_KEY = ORIG_KEY;
  if (ORIG_HOST === undefined) delete process.env.POSTHOG_HOST;
  else process.env.POSTHOG_HOST = ORIG_HOST;
});

let counter = 0;
async function freshPosthogNode() {
  counter++;
  return await import(`./posthog-node.ts?realposthog=${counter}`);
}

test("getPosthog returns null with no POSTHOG_KEY, and caches the null decision", async () => {
  delete process.env.POSTHOG_KEY;
  const { getPosthog } = await freshPosthogNode();
  expect(getPosthog()).toBeNull();
  expect(getPosthog()).toBeNull(); // second call hits the cached tri-state, not undefined
});

test("captureError / captureEvent are no-ops when disabled (no key)", async () => {
  delete process.env.POSTHOG_KEY;
  const { captureError, captureEvent } = await freshPosthogNode();
  // Must not throw even with a real Error and rich context/properties.
  expect(() => captureError(new Error("boom"), { distinctId: "u1", traceId: "t1" }, { extra: true })).not.toThrow();
  expect(() => captureEvent("some_event", { distinctId: "u1" }, { a: 1 })).not.toThrow();
  expect(() => captureError(new Error("boom"))).not.toThrow(); // default ctx = {}
  expect(() => captureEvent("no_ctx_event")).not.toThrow();
});

test("shutdownPosthog resolves without a client (no-op)", async () => {
  delete process.env.POSTHOG_KEY;
  const { shutdownPosthog } = await freshPosthogNode();
  await expect(shutdownPosthog()).resolves.toBeUndefined();
});

// Note: deliberately never calling shutdownPosthog() once an event has been
// enqueued against a real client here — this environment's outbound proxy
// turns the SDK's flush-on-shutdown retry into a multi-second hang instead of
// the instant ECONNREFUSED a bare loopback port would give. Not awaiting
// shutdown is safe (bun test doesn't block process exit on the dangling
// flush timer) and still exercises every line in the enabled branch.
test("getPosthog constructs a real client when POSTHOG_KEY is set, and reuses it", async () => {
  process.env.POSTHOG_KEY = "phc_test_key_1234567890";
  process.env.POSTHOG_HOST = "http://127.0.0.1:1";
  const { getPosthog } = await freshPosthogNode();
  const a = getPosthog();
  const b = getPosthog();
  expect(a).not.toBeNull();
  expect(a).toBe(b); // same cached instance
});

test("captureError / captureEvent call through to a real (but unreachable) client without throwing", async () => {
  process.env.POSTHOG_KEY = "phc_test_key_1234567890";
  process.env.POSTHOG_HOST = "http://127.0.0.1:1";
  const { captureError, captureEvent } = await freshPosthogNode();
  expect(() =>
    captureError(new Error("boom"), { distinctId: "u1", traceId: "trace-1", properties: { p: 1 } }, { extra: 2 }),
  ).not.toThrow();
  expect(() => captureEvent("evt", { distinctId: "u1", traceId: "trace-1" }, { p: 2 })).not.toThrow();
  expect(() => captureEvent("evt_no_distinct")).not.toThrow(); // exercises the "server" distinctId default
});
