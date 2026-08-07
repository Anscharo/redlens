// Real posthog-node.ts unit tests. mcp.test.ts registers a COMPLETE
// mock.module("./posthog-node.ts", ...) that persists globally for the rest of
// the process — a cache-busting query string (`?realposthog=N`) gets a fresh,
// real module instance regardless of load order (same trick as db.test.ts /
// config.test.ts). POSTHOG_HOST is pointed at an unroutable local port AND
// globalThis.fetch is stubbed for the duration of the two "enabled" tests (see
// withStubbedFetch below), so the SDK's batch flush resolves instantly instead
// of reaching the network; shutdownPosthog() is then awaited so no SDK timer or
// in-flight retry survives this file.
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

// Once an event is enqueued against a real client, that client owns a batching
// timer and will eventually flush over globalThis.fetch. Leaving it dangling
// used to leak out of this file: the flush fired minutes later, during whatever
// file was running then, hit the shared llm test dispatcher ("no fetch impl set
// for this test"), and burned the event loop on the SDK's three retries with
// backoff — enough, under CPU contention, to push an unrelated 5s-budget test
// (preview.test.ts's gzip-bomb case) over its timeout, while spraying
// PostHogFetchNetworkError stacks into the middle of another file's output.
// So: stub fetch to a instant 200 for the duration, then await shutdown, which
// flushes and clears the timer before the test returns.
async function withStubbedFetch<T>(fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("getPosthog constructs a real client when POSTHOG_KEY is set, and reuses it", async () => {
  process.env.POSTHOG_KEY = "phc_test_key_1234567890";
  process.env.POSTHOG_HOST = "http://127.0.0.1:1";
  await withStubbedFetch(async () => {
    const { getPosthog, shutdownPosthog } = await freshPosthogNode();
    const a = getPosthog();
    const b = getPosthog();
    expect(a).not.toBeNull();
    expect(a).toBe(b); // same cached instance
    await shutdownPosthog();
  });
});

test("captureError / captureEvent call through to a real (but unreachable) client without throwing", async () => {
  process.env.POSTHOG_KEY = "phc_test_key_1234567890";
  process.env.POSTHOG_HOST = "http://127.0.0.1:1";
  await withStubbedFetch(async () => {
    const { captureError, captureEvent, shutdownPosthog } = await freshPosthogNode();
    expect(() =>
      captureError(new Error("boom"), { distinctId: "u1", traceId: "trace-1", properties: { p: 1 } }, { extra: 2 }),
    ).not.toThrow();
    expect(() => captureEvent("evt", { distinctId: "u1", traceId: "trace-1" }, { p: 2 })).not.toThrow();
    expect(() => captureEvent("evt_no_distinct")).not.toThrow(); // exercises the "server" distinctId default
    await shutdownPosthog();
  });
});
