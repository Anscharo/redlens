import { describe, expect, it, vi } from "vitest";
import { abortableSleep, IDENTITY_WAITS_MS, loadIdentityVerdict } from "./previewIdentity";

const res = (status: number, body: unknown = {}) => ({ status, json: async () => body }) as Response;
const VERDICT = { identitySwap: { a: { oldTitle: "Approve", newTitle: "Swap" } }, formerUuid: {} };

/** A fetch that answers from a list, and records what was asked and waited. */
function harness(answers: Response[]) {
  const urls: string[] = [];
  const waits: number[] = [];
  return {
    urls,
    waits,
    fetch: (async (url: string) => { urls.push(url); return answers.shift() ?? res(404); }) as unknown as typeof fetch,
    wait: async (ms: number) => { waits.push(ms); },
  };
}

describe("abortableSleep", () => {
  it("resolves after the wait", async () => {
    const t0 = Date.now();
    await abortableSleep(15);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(10);
  });

  it("rejects at once on a signal already aborted, and when the signal aborts during the wait", async () => {
    const spent = new AbortController();
    spent.abort();
    await expect(abortableSleep(1000, spent.signal)).rejects.toThrow("aborted");
    const c = new AbortController();
    const p = abortableSleep(1000, c.signal);
    c.abort();
    await expect(p).rejects.toThrow("aborted");
  });

  it("leaves no listener on the signal once the timer wins", async () => {
    const c = new AbortController();
    const spy = vi.spyOn(c.signal, "removeEventListener");
    await abortableSleep(5, c.signal);
    expect(spy).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("is the wait loadIdentityVerdict uses when none is injected", async () => {
    // Real timers: the first wait is two seconds, and the signal cuts it short.
    const c = new AbortController();
    let n = 0;
    const get = (async () => { n++; setTimeout(() => c.abort(), 5); return res(202); }) as unknown as typeof fetch;
    const t0 = Date.now();
    expect(await loadIdentityVerdict("/p/", null, { fetch: get, signal: c.signal })).toBeNull();
    expect(n).toBe(1);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("loadIdentityVerdict", () => {
  it("returns the verdict when the file is there", async () => {
    const h = harness([res(200, VERDICT)]);
    expect(await loadIdentityVerdict("/api/preview/abc/", null, h)).toEqual(VERDICT);
    expect(h.urls).toEqual(["/api/preview/abc/identity.json"]);
    expect(h.waits).toEqual([]);
  });

  it("asks for the file of the base the diff was loaded for", async () => {
    const h = harness([res(200, VERDICT)]);
    await loadIdentityVerdict("/api/preview/abc/", "repo", h);
    expect(h.urls).toEqual(["/api/preview/abc/identity.repo.json"]);
  });

  it("waits and asks again while the server says not yet", async () => {
    const h = harness([res(202), res(202), res(200, VERDICT)]);
    expect(await loadIdentityVerdict("/p/", null, h)).toEqual(VERDICT);
    expect(h.urls.length).toBe(3);
    expect(h.waits).toEqual(IDENTITY_WAITS_MS.slice(0, 2));
  });

  it("keeps what diff.json said when no verdict is coming", async () => {
    const h = harness([res(404)]);
    expect(await loadIdentityVerdict("/p/", null, h)).toBeNull();
    expect(h.waits).toEqual([]);
  });

  it("gives up when the server never finishes", async () => {
    const h = harness(Array.from({ length: 50 }, () => res(202)));
    expect(await loadIdentityVerdict("/p/", null, h)).toBeNull();
    expect(h.urls.length).toBe(IDENTITY_WAITS_MS.length + 1);
  });

  it("an empty verdict is a verdict: it clears the warnings", async () => {
    const h = harness([res(200, {})]);
    expect(await loadIdentityVerdict("/p/", null, h)).toEqual({ identitySwap: {}, formerUuid: {} });
  });

  it("never rejects: a network failure or an abort reads as no verdict", async () => {
    const failing = { fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch };
    expect(await loadIdentityVerdict("/p/", null, failing)).toBeNull();
    const h = harness([res(202)]);
    const aborted = { ...h, wait: async () => { throw new Error("aborted"); } };
    expect(await loadIdentityVerdict("/p/", null, aborted)).toBeNull();
  });
});
