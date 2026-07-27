// Real posthog-capture.ts unit tests (no SDK — hand-rolled fetch POST). Uses
// cache-busting query imports so serverAnalyticsEnabled reflects POSTHOG_KEY at
// each import (mirrors config.test.ts / db.test.ts). globalThis.fetch is
// stubbed to assert the request shape without hitting the network, then
// restored.
import { test, expect, afterEach } from "bun:test";

const ORIG_KEY = process.env.POSTHOG_KEY;
const ORIG_FETCH = globalThis.fetch;

afterEach(() => {
  if (ORIG_KEY === undefined) delete process.env.POSTHOG_KEY;
  else process.env.POSTHOG_KEY = ORIG_KEY;
  globalThis.fetch = ORIG_FETCH;
});

let counter = 0;
async function freshCapture() {
  counter++;
  return await import(`./posthog-capture.ts?realcapture=${counter}`);
}

test("serverAnalyticsEnabled is false with no POSTHOG_KEY", async () => {
  delete process.env.POSTHOG_KEY;
  const { serverAnalyticsEnabled } = await freshCapture();
  expect(serverAnalyticsEnabled).toBe(false);
});

test("serverAnalyticsEnabled is true when POSTHOG_KEY is set", async () => {
  process.env.POSTHOG_KEY = "phc_test_key";
  const { serverAnalyticsEnabled } = await freshCapture();
  expect(serverAnalyticsEnabled).toBe(true);
});

test("captureServerEvent is a no-op (never calls fetch) when disabled", async () => {
  delete process.env.POSTHOG_KEY;
  const { captureServerEvent } = await freshCapture();
  let called = false;
  globalThis.fetch = (() => {
    called = true;
    return Promise.resolve(new Response("ok"));
  }) as unknown as typeof fetch;
  captureServerEvent("tool_used", "anon-1", { tool: "atlas_get" });
  await Promise.resolve(); // let any microtask fire
  expect(called).toBe(false);
});

test("captureServerEvent posts the expected shape when enabled", async () => {
  process.env.POSTHOG_KEY = "phc_test_key";
  const { captureServerEvent } = await freshCapture();

  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return Promise.resolve(new Response("ok"));
  }) as unknown as typeof fetch;

  captureServerEvent("tool_used", "anon-1", { tool: "atlas_get" });

  expect(capturedUrl).toBe("https://us.i.posthog.com/i/v0/e/");
  expect(capturedInit?.method).toBe("POST");
  const body = JSON.parse(capturedInit!.body as string);
  expect(body.api_key).toBe("phc_test_key");
  expect(body.event).toBe("tool_used");
  expect(body.distinct_id).toBe("anon-1");
  expect(body.properties.tool).toBe("atlas_get");
  expect(body.properties.$geoip_disable).toBe(true);
  expect(body.properties.$process_person_profile).toBe(false);
});

test("captureServerEvent defaults properties to {} and never throws on a failed fetch", async () => {
  process.env.POSTHOG_KEY = "phc_test_key";
  const { captureServerEvent } = await freshCapture();
  globalThis.fetch = (() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;
  expect(() => captureServerEvent("evt", "anon-2")).not.toThrow();
  await Promise.resolve();
});
