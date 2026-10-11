// @vitest-environment jsdom
// loadPreviewMeta shares one meta.json request per base across every preview
// surface; usePreviewMeta reads it without suspending.

import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { loadPreviewMeta, resetPreviewMetaCache, usePreviewMeta } from "./previewMeta";

const BASE = "/api/preview/abc/";

function mockMeta(body: unknown, ok = true) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok, json: () => Promise.resolve(body) } as Response);
}

afterEach(() => {
  cleanup();
  resetPreviewMetaCache();
  vi.restoreAllMocks();
});

describe("loadPreviewMeta", () => {
  it("makes one request per base however many callers ask", async () => {
    const fetchMock = mockMeta({ repo: "o/r" });
    const [a, b] = await Promise.all([loadPreviewMeta(BASE), loadPreviewMeta(BASE)]);
    expect(a).toEqual({ repo: "o/r" });
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}meta.json`);
  });

  it("resolves null on a non-ok answer or a rejection, and asks again next time", async () => {
    const fetchMock = mockMeta(null, false);
    expect(await loadPreviewMeta(BASE)).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await loadPreviewMeta(BASE)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("usePreviewMeta", () => {
  it("is undefined while loading, then the meta", async () => {
    mockMeta({ repo: "o/r" });
    const { result } = renderHook(() => usePreviewMeta(BASE));
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toEqual({ repo: "o/r" }));
  });

  it("answers a later mount from the first render, without a second request", async () => {
    const fetchMock = mockMeta({ repo: "o/r" });
    await loadPreviewMeta(BASE);
    const { result } = renderHook(() => usePreviewMeta(BASE));
    expect(result.current).toEqual({ repo: "o/r" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("answers null when the meta could not be read", async () => {
    mockMeta(null, false);
    const { result } = renderHook(() => usePreviewMeta(BASE));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("asks for nothing when the base is null", () => {
    const fetchMock = mockMeta({});
    const { result } = renderHook(() => usePreviewMeta(null));
    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
