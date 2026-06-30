// Run under `bun test`. Mocks global fetch to assert the proxy strips IP headers,
// rewrites Host to the upstream, and routes assets vs ingest correctly.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { handlePosthogProxy } from "./posthog-proxy.ts";

const realFetch = globalThis.fetch;
let calls: { url: string; headers: Headers }[] = [];

beforeEach(() => {
  calls = [];
  globalThis.fetch = ((url: unknown, init: { headers?: Headers | Record<string, string> }) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    return Promise.resolve(new Response("ok", { status: 200 }));
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("handlePosthogProxy", () => {
  it("forwards capture to the ingest host, strips IP headers, rewrites Host", async () => {
    const req = new Request("http://app.example/z/e/?ver=1", {
      method: "POST",
      headers: {
        "x-forwarded-for": "1.2.3.4",
        "x-real-ip": "5.6.7.8",
        "cf-connecting-ip": "9.9.9.9",
        "forwarded": "for=1.2.3.4",
        "content-type": "text/plain",
      },
      body: "data",
    });

    const res = await handlePosthogProxy(req, "/z/e/");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://us.i.posthog.com/e/?ver=1");

    const h = calls[0].headers;
    expect(h.get("x-forwarded-for")).toBeNull();
    expect(h.get("x-real-ip")).toBeNull();
    expect(h.get("cf-connecting-ip")).toBeNull();
    expect(h.get("forwarded")).toBeNull();
    expect(h.get("host")).toBe("us.i.posthog.com");
    expect(h.get("content-type")).toBe("text/plain"); // non-IP headers pass through
  });

  it("routes /z/static/* to the assets host", async () => {
    const req = new Request("http://app.example/z/static/array.js", { method: "GET" });
    await handlePosthogProxy(req, "/z/static/array.js");
    expect(calls[0].url).toBe("https://us-assets.i.posthog.com/static/array.js");
    expect(calls[0].headers.get("host")).toBe("us-assets.i.posthog.com");
  });

  it("rejects non-allowlisted paths without calling upstream", async () => {
    const req = new Request("http://app.example/z/wp-admin", { method: "GET" });
    const res = await handlePosthogProxy(req, "/z/wp-admin");
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});
