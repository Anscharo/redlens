// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const track = vi.fn();
vi.mock("./analytics", () => ({ track: (...a: unknown[]) => track(...a) }));

// Fresh module registry per test: atlasBase.ts keeps module-level `reloading` /
// `reloadDecision` state (the reload gate), so each test needs its own copy —
// and StaleAtlasError must come from the same fresh registry for `instanceof`
// checks inside handledStale() to hold.
async function freshModule() {
  vi.resetModules();
  const atlasBase = await import("./atlasBase");
  const { StaleAtlasError } = await import("./verify");
  return { ...atlasBase, StaleAtlasError };
}

const REAL_HREF_KEY = Symbol("real-location");
type WithSavedLocation = typeof window & { [REAL_HREF_KEY]?: Location };

function stubReload(): ReturnType<typeof vi.fn> {
  const reload = vi.fn();
  (window as WithSavedLocation)[REAL_HREF_KEY] ??= window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
  return reload;
}

beforeEach(() => {
  track.mockClear();
  sessionStorage.clear();
  delete (window as unknown as { __ATLAS_SHA__?: string }).__ATLAS_SHA__;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  const saved = (window as WithSavedLocation)[REAL_HREF_KEY];
  if (saved) Object.defineProperty(window, "location", { configurable: true, value: saved });
});

describe("liveAtlasBase / liveAtlasSha", () => {
  it("falls back to BASE_URL / null when __ATLAS_SHA__ is unset", async () => {
    const { liveAtlasBase, liveAtlasSha } = await freshModule();
    expect(liveAtlasBase()).toBe(import.meta.env.BASE_URL);
    expect(liveAtlasSha()).toBeNull();
  });

  it("falls back when __ATLAS_SHA__ is the un-substituted {{ATLAS_SHA}} placeholder", async () => {
    window.__ATLAS_SHA__ = "{{ATLAS_SHA}}";
    const { liveAtlasBase, liveAtlasSha } = await freshModule();
    expect(liveAtlasBase()).toBe(import.meta.env.BASE_URL);
    expect(liveAtlasSha()).toBeNull();
  });

  it("falls back on a malformed (too-short) sha", async () => {
    window.__ATLAS_SHA__ = "deadbeef";
    const { liveAtlasBase, liveAtlasSha } = await freshModule();
    expect(liveAtlasBase()).toBe(import.meta.env.BASE_URL);
    expect(liveAtlasSha()).toBeNull();
  });

  it("builds the sha-keyed base for a valid 40-hex sha", async () => {
    const sha = "a".repeat(40);
    window.__ATLAS_SHA__ = sha;
    const { liveAtlasBase, liveAtlasSha } = await freshModule();
    expect(liveAtlasBase()).toBe(`/api/atlas/${sha}/`);
    expect(liveAtlasSha()).toBe(sha);
  });

  it("accepts uppercase hex (SHA_RE is case-insensitive)", async () => {
    const sha = "A".repeat(40);
    window.__ATLAS_SHA__ = sha;
    const { liveAtlasBase, liveAtlasSha } = await freshModule();
    expect(liveAtlasBase()).toBe(`/api/atlas/${sha}/`);
    expect(liveAtlasSha()).toBe(sha);
  });
});

describe("handledStale", () => {
  it("returns false and never reloads for an unrelated error", async () => {
    const { handledStale } = await freshModule();
    const reload = stubReload();
    expect(handledStale(new Error("boom"))).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("reloads (after the settle delay) for a StaleAtlasError instance, probing the url first", async () => {
    vi.useFakeTimers();
    const reload = stubReload();
    const fetchMock = vi.fn(() => Promise.resolve(new Response("", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    const { handledStale, StaleAtlasError } = await freshModule();
    const err = new StaleAtlasError("/api/atlas/deadbeef/docs.json");

    expect(handledStale(err)).toBe(true);
    expect(track).toHaveBeenCalledWith("atlas_stale_reload", { url: err.url, reloaded: true });
    expect(reload).not.toHaveBeenCalled(); // not yet — the 2s settle delay hasn't elapsed

    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledWith(err.url, { method: "HEAD" });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("atlas_stale_reload_probe", { url: err.url, ok: true });
  });

  it("still reloads when the probe rejects (ok:false, diagnostic only)", async () => {
    vi.useFakeTimers();
    const reload = stubReload();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));

    const { handledStale, StaleAtlasError } = await freshModule();
    const err = new StaleAtlasError("/api/atlas/deadbeef/docs.json");
    handledStale(err);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("atlas_stale_reload_probe", { url: err.url, ok: false });
  });

  it("reloads on the probe timeout when fetch never settles", async () => {
    vi.useFakeTimers();
    const reload = stubReload();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );

    const { handledStale, StaleAtlasError } = await freshModule();
    const err = new StaleAtlasError("/api/atlas/deadbeef/docs.json");
    handledStale(err);

    await vi.advanceTimersByTimeAsync(2_000); // settle delay elapses, probe starts
    expect(reload).not.toHaveBeenCalled(); // probe still hanging
    await vi.advanceTimersByTimeAsync(1_500); // PROBE_TIMEOUT_MS elapses
    expect(reload).toHaveBeenCalledTimes(1);
    // the timeout, not the probe, wins the race — `ok` carries the literal "timeout"
    expect(track).toHaveBeenCalledWith("atlas_stale_reload_probe", { url: err.url, ok: "timeout" });
  });

  it("reloads without a probe for a name-matched Error (message variant, no url)", async () => {
    vi.useFakeTimers();
    const reload = stubReload();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { handledStale } = await freshModule();
    const err = new Error("StaleAtlasError: /api/atlas/deadbeef/docs.json");
    err.name = "StaleAtlasError"; // not `instanceof StaleAtlasError` — exercises the message branch

    expect(handledStale(err)).toBe(true);
    expect(track).toHaveBeenCalledWith("atlas_stale_reload", { message: err.message, reloaded: true });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).not.toHaveBeenCalled(); // no url to probe
    expect(reload).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalledWith("atlas_stale_reload_probe", expect.anything());
  });

  it("truncates an overlong message to 120 chars before tracking", async () => {
    vi.useFakeTimers();
    stubReload();
    const { handledStale } = await freshModule();
    const err = new Error("StaleAtlasError: " + "x".repeat(200));
    err.name = "StaleAtlasError";

    handledStale(err);
    const call = track.mock.calls.find((c) => c[0] === "atlas_stale_reload");
    expect(call).toBeDefined();
    expect((call![1] as { message: string }).message.length).toBe(120);
  });

  it("only schedules a single reload for concurrent stale errors on the same page", async () => {
    vi.useFakeTimers();
    const reload = stubReload();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", { status: 200 }))));

    const { handledStale, StaleAtlasError } = await freshModule();
    const r1 = handledStale(new StaleAtlasError("/api/atlas/a/docs.json"));
    const r2 = handledStale(new StaleAtlasError("/api/atlas/b/graph.json"));

    expect(r1).toBe(true);
    expect(r2).toBe(true); // cached reloadDecision, not re-derived
    expect(track).toHaveBeenCalledTimes(1); // second call short-circuits before tracking

    await vi.advanceTimersByTimeAsync(2_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("stashes the live sha under the forced-reload marker key before reloading", async () => {
    vi.useFakeTimers();
    stubReload();
    window.__ATLAS_SHA__ = "b".repeat(40);
    const { handledStale, StaleAtlasError } = await freshModule();
    handledStale(new StaleAtlasError("/api/atlas/b/docs.json"));
    expect(sessionStorage.getItem("rl-forced-reload-from")).toBe("b".repeat(40));
  });

  it("stashes 'invalid' under the marker key when there is no valid live sha", async () => {
    vi.useFakeTimers();
    stubReload();
    const { handledStale, StaleAtlasError } = await freshModule();
    handledStale(new StaleAtlasError("/api/atlas/b/docs.json"));
    expect(sessionStorage.getItem("rl-forced-reload-from")).toBe("invalid");
  });

  it("stops reloading once the session has used its budget of 3 forced reloads", async () => {
    sessionStorage.setItem("rl-forced-reload-count", JSON.stringify({ n: 3, t: Date.now() }));
    const reload = stubReload();
    const { handledStale, StaleAtlasError } = await freshModule();

    const result = handledStale(new StaleAtlasError("/api/atlas/a/docs.json"));

    expect(result).toBe(false);
    expect(track).toHaveBeenCalledWith("atlas_stale_reload", { url: "/api/atlas/a/docs.json", reloaded: false });
    expect(reload).not.toHaveBeenCalled();
  });

  it("resets the reload budget once the rolling 60s window has elapsed", async () => {
    vi.useFakeTimers();
    sessionStorage.setItem("rl-forced-reload-count", JSON.stringify({ n: 3, t: Date.now() - 61_000 }));
    stubReload();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", { status: 200 }))));
    const { handledStale, StaleAtlasError } = await freshModule();

    const result = handledStale(new StaleAtlasError("/api/atlas/a/docs.json"));

    expect(result).toBe(true);
    expect(track).toHaveBeenCalledWith("atlas_stale_reload", { url: "/api/atlas/a/docs.json", reloaded: true });
    expect(JSON.parse(sessionStorage.getItem("rl-forced-reload-count") ?? "{}").n).toBe(1);
  });

  it("fails open (still reloads) when sessionStorage throws", async () => {
    vi.useFakeTimers();
    const reload = stubReload();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", { status: 200 }))));
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    const { handledStale, StaleAtlasError } = await freshModule();
    const result = handledStale(new StaleAtlasError("/api/atlas/a/docs.json"));

    expect(result).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reload).toHaveBeenCalledTimes(1);

    setItemSpy.mockRestore();
  });
});

describe("handledStaleMessage", () => {
  it("returns false and never reloads for an unrelated message", async () => {
    const { handledStaleMessage } = await freshModule();
    const reload = stubReload();
    expect(handledStaleMessage("some other error")).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("reloads (after the settle delay) when the message signals a stale sha", async () => {
    vi.useFakeTimers();
    const reload = stubReload();
    const message = "StaleAtlasError: /api/atlas/deadbeef/docs.json";

    const { handledStaleMessage } = await freshModule();
    expect(handledStaleMessage(message)).toBe(true);
    expect(track).toHaveBeenCalledWith("atlas_stale_reload", { message, reloaded: true });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
