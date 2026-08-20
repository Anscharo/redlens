import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("loadHealth", () => {
  it("GETs /api/health and returns the parsed body", async () => {
    const body = { status: "ok", atlas_sha: "abc123", docs: 42 };
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))));
    const { loadHealth } = await import("./health");
    await expect(loadHealth()).resolves.toEqual(body);
  });

  it("caches the request — a second call doesn't refetch", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ status: "ok", atlas_sha: null, docs: 0 }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const { loadHealth } = await import("./health");
    const p1 = loadHealth();
    const p2 = loadHealth();
    expect(p1).toBe(p2);
    await p1;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves null on a non-ok response (degrades silently)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", { status: 500 }))));
    const { loadHealth } = await import("./health");
    await expect(loadHealth()).resolves.toBeNull();
  });

  it("resolves null when fetch itself rejects (offline / no backend)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));
    const { loadHealth } = await import("./health");
    await expect(loadHealth()).resolves.toBeNull();
  });
});
