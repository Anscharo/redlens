// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { DataSource } from "./dataSource";

let dataSourceValue: DataSource = { base: "/api/atlas/live/", preview: null };
let baseKeyValue: "sky" | "repo" | null = null;

vi.mock("./dataSource", () => ({
  useDataSource: () => dataSourceValue,
}));
vi.mock("./previewView", () => ({
  usePreviewView: () => ({ baseKey: baseKeyValue, setBaseKey: vi.fn(), onlyChanged: false, setOnlyChanged: vi.fn() }),
}));

import { usePreviewDiff, usePreviewPatch, PreviewDiffProvider } from "./previewDiff";

function wrapper({ children }: { children: ReactNode }) {
  return <PreviewDiffProvider>{children}</PreviewDiffProvider>;
}

// Routes a fetch mock by URL suffix — every test below cares about which
// artifact was requested, not the order in which fetch happens to be called.
function mockFetchByUrl(routes: Record<string, unknown | null>) {
  return vi.fn((url: string) => {
    for (const [suffix, payload] of Object.entries(routes)) {
      if (url.endsWith(suffix)) {
        return Promise.resolve(
          payload === null ? { ok: false } : ({ ok: true, json: () => Promise.resolve(payload) } as Response),
        );
      }
    }
    return Promise.resolve({ ok: false } as Response);
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  dataSourceValue = { base: "/api/atlas/live/", preview: null };
  baseKeyValue = null;
});

describe("usePreviewDiff", () => {
  it("returns the EMPTY default without a provider", () => {
    const { result } = renderHook(() => usePreviewDiff());
    expect(result.current.added.size).toBe(0);
    expect(result.current.changed.size).toBe(0);
    expect(result.current.renumbered).toEqual({});
    expect(result.current.retitled).toEqual({});
    expect(result.current.reusedSlot).toEqual({});
    expect(result.current.identitySwap).toEqual({});
    expect(result.current.formerUuid).toEqual({});
    expect(result.current.activeBase).toBeNull();
  });

  it("stays EMPTY and never fetches outside preview mode", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => usePreviewDiff(), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.added.size).toBe(0);
  });

  it("old bundle (no bases in meta.json) fetches plain diff.json", async () => {
    dataSourceValue = { base: "/api/preview/old/", preview: { id: "old", sha: "deadbeef" } };
    const fetchMock = mockFetchByUrl({
      "meta.json": { sha: "deadbeef" },
      "diff.json": { added: ["a"], changed: [] },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePreviewDiff(), { wrapper });
    await waitFor(() => expect(result.current.added.has("a")).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/preview/old/diff.json");
    expect(result.current.activeBase).toBeNull();
  });

  it("populates every diff field in preview mode", async () => {
    dataSourceValue = { base: "/api/preview/abc/", preview: { id: "abc", sha: "deadbeef" } };
    const payload = {
      added: ["a"],
      changed: ["b"],
      renumbered: { b: ["A.1", "A.2"] },
      retitled: { b: ["Old Title", "New Title"] },
      reusedSlot: { c: { title: "Old" } },
      identitySwap: { d: { oldTitle: "X", newTitle: "Y" } },
      formerUuid: { e: { previousId: "old-e", previousTitle: "Old E", previousDocNo: "A.9" } },
    };
    const fetchMock = mockFetchByUrl({ "meta.json": {}, "diff.json": payload });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePreviewDiff(), { wrapper });

    await waitFor(() => expect(result.current.added.has("a")).toBe(true));
    expect(result.current.changed.has("b")).toBe(true);
    expect(result.current.renumbered).toEqual({ b: ["A.1", "A.2"] });
    expect(result.current.retitled).toEqual({ b: ["Old Title", "New Title"] });
    expect(result.current.reusedSlot).toEqual({ c: { title: "Old" } });
    expect(result.current.identitySwap.d.oldTitle).toBe("X");
    expect(result.current.formerUuid.e.previousId).toBe("old-e");
  });

  it("bases.auto = 'repo' (no URL override) fetches diff.repo.json and sets activeBase", async () => {
    dataSourceValue = { base: "/api/preview/autorepo/", preview: { id: "autorepo", sha: "deadbeef" } };
    const meta = { bases: { auto: "repo", repo: { repo: "acme/fork", ref: "main", mergeBase: "x" } } };
    const fetchMock = mockFetchByUrl({
      "meta.json": meta,
      "diff.repo.json": { added: ["r"], changed: [] },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePreviewDiff(), { wrapper });
    await waitFor(() => expect(result.current.added.has("r")).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/preview/autorepo/diff.repo.json");
    expect(result.current.activeBase).toEqual({ key: "repo", repo: "acme/fork", ref: "main", auto: true });
  });

  it("?base=sky overrides bases.auto and fetches diff.sky.json", async () => {
    baseKeyValue = "sky";
    dataSourceValue = { base: "/api/preview/override/", preview: { id: "override", sha: "deadbeef" } };
    const meta = {
      bases: {
        auto: "repo",
        sky: { repo: "sky-ecosystem/next-gen-atlas", ref: "main", mergeBase: "x" },
        repo: { repo: "acme/fork", ref: "main", mergeBase: "y" },
      },
    };
    const fetchMock = mockFetchByUrl({
      "meta.json": meta,
      "diff.sky.json": { added: ["s"], changed: [] },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePreviewDiff(), { wrapper });
    await waitFor(() => expect(result.current.added.has("s")).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/preview/override/diff.sky.json");
    expect(result.current.activeBase).toEqual({
      key: "sky",
      repo: "sky-ecosystem/next-gen-atlas",
      ref: "main",
      auto: false,
    });
  });

  it("?base= override for a candidate the bundle lacks falls back to bases.auto's plain diff.json", async () => {
    baseKeyValue = "repo";
    dataSourceValue = { base: "/api/preview/norepo/", preview: { id: "norepo", sha: "deadbeef" } };
    const meta = { bases: { auto: "sky", sky: { repo: "sky-ecosystem/next-gen-atlas", ref: "main", mergeBase: "x" } } };
    const fetchMock = mockFetchByUrl({ "meta.json": meta, "diff.json": { added: [], changed: ["c"] } });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePreviewDiff(), { wrapper });
    await waitFor(() => expect(result.current.changed.has("c")).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/preview/norepo/diff.json");
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("diff.repo.json"));
    expect(result.current.activeBase).toEqual({
      key: "sky",
      repo: "sky-ecosystem/next-gen-atlas",
      ref: "main",
      auto: true,
    });
  });

  it("a keyed diff response that 404s falls back to plain diff.json", async () => {
    baseKeyValue = "sky";
    dataSourceValue = { base: "/api/preview/keyed404/", preview: { id: "keyed404", sha: "deadbeef" } };
    const meta = { bases: { auto: "sky", sky: { repo: "sky-ecosystem/next-gen-atlas", ref: "main", mergeBase: "x" } } };
    const fetchMock = mockFetchByUrl({
      "meta.json": meta,
      "diff.sky.json": null,
      "diff.json": { added: ["fallback"], changed: [] },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePreviewDiff(), { wrapper });
    await waitFor(() => expect(result.current.added.has("fallback")).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/preview/keyed404/diff.sky.json");
    expect(fetchMock).toHaveBeenCalledWith("/api/preview/keyed404/diff.json");
  });

  it("live-main degraded auto pick", async () => {
    dataSourceValue = { base: "/api/preview/degraded/", preview: { id: "degraded", sha: "deadbeef" } };
    const meta = { bases: { auto: "live-main", reason: "no fork point found" } };
    const fetchMock = mockFetchByUrl({ "meta.json": meta, "diff.json": { added: [], changed: [] } });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePreviewDiff(), { wrapper });
    await waitFor(() => expect(result.current.activeBase).toEqual({ key: "live-main", auto: true }));
  });

  it("normalizes a legacy array-shaped reusedSlot into an object", async () => {
    dataSourceValue = { base: "/api/preview/legacy/", preview: { id: "legacy", sha: "deadbeef" } };
    const fetchMock = mockFetchByUrl({ "meta.json": {}, "diff.json": { added: [], changed: [], reusedSlot: ["x", "y"] } });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePreviewDiff(), { wrapper });
    await waitFor(() => expect(result.current.reusedSlot).toEqual({ x: {}, y: {} }));
  });

  it("keeps EMPTY when meta.json is not ok", async () => {
    dataSourceValue = { base: "/api/preview/metanotok/", preview: { id: "metanotok", sha: "deadbeef" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => usePreviewDiff(), { wrapper });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.added.size).toBe(0);
  });

  it("swallows a meta.json fetch rejection and still resolves diff.json", async () => {
    dataSourceValue = { base: "/api/preview/metareject/", preview: { id: "metareject", sha: "deadbeef" } };
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("meta.json")) return Promise.reject(new Error("network down"));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ added: ["a"], changed: [] }) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePreviewDiff(), { wrapper });
    await waitFor(() => expect(result.current.added.has("a")).toBe(true));
    expect(result.current.activeBase).toBeNull();
  });

  it("resets to EMPTY when preview goes back to null", async () => {
    dataSourceValue = { base: "/api/preview/reset/", preview: { id: "reset", sha: "deadbeef" } };
    const fetchMock = mockFetchByUrl({ "meta.json": {}, "diff.json": { added: ["a"], changed: [] } });
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender } = renderHook(() => usePreviewDiff(), { wrapper });
    await waitFor(() => expect(result.current.added.has("a")).toBe(true));

    dataSourceValue = { base: "/api/atlas/live/", preview: null };
    rerender();
    await waitFor(() => expect(result.current.added.size).toBe(0));
  });
});

describe("usePreviewPatch", () => {
  it("returns null and does not fetch outside preview mode", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => usePreviewPatch("node-1"));
    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches plain patches.json outside a diff provider (no activeBase)", async () => {
    dataSourceValue = { base: "/api/preview/patch-test/", preview: { id: "patch-test", sha: "deadbeef" } };
    const lines = [{ type: "add", text: "hello" }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ "node-1": lines }) });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePreviewPatch("node-1"));
    await waitFor(() => expect(result.current).toEqual(lines));
    expect(fetchMock).toHaveBeenCalledWith("/api/preview/patch-test/patches.json");
  });

  it("follows the diff provider's resolved base to fetch patches.<key>.json", async () => {
    dataSourceValue = { base: "/api/preview/patch-repo/", preview: { id: "patch-repo", sha: "deadbeef" } };
    const meta = { bases: { auto: "repo", repo: { repo: "acme/fork", ref: "main", mergeBase: "x" } } };
    const fetchMock = mockFetchByUrl({
      "meta.json": meta,
      "diff.repo.json": { added: [], changed: [] },
      "patches.repo.json": { "node-1": [{ type: "add", text: "hi" }] },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePreviewPatch("node-1"), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/preview/patch-repo/patches.repo.json"));
    await waitFor(() => expect(result.current).toEqual([{ type: "add", text: "hi" }]));
  });

  it("falls back to patches.json when the keyed patches response 404s", async () => {
    dataSourceValue = { base: "/api/preview/patch-404/", preview: { id: "patch-404", sha: "deadbeef" } };
    const meta = { bases: { auto: "repo", repo: { repo: "acme/fork", ref: "main", mergeBase: "x" } } };
    const fetchMock = mockFetchByUrl({
      "meta.json": meta,
      "diff.repo.json": { added: [], changed: [] },
      "patches.repo.json": null,
      "patches.json": { "node-1": [{ type: "del", text: "bye" }] },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePreviewPatch("node-1"), { wrapper });
    await waitFor(() => expect(result.current).toEqual([{ type: "del", text: "bye" }]));
    expect(fetchMock).toHaveBeenCalledWith("/api/preview/patch-404/patches.repo.json");
    expect(fetchMock).toHaveBeenCalledWith("/api/preview/patch-404/patches.json");
  });

  it("returns null for a node id absent from the patch map", async () => {
    dataSourceValue = { base: "/api/preview/patch-missing/", preview: { id: "patch-missing", sha: "deadbeef" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));

    const { result } = renderHook(() => usePreviewPatch("missing-node"));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("falls back to {} when the patches fetch response is not ok", async () => {
    dataSourceValue = { base: "/api/preview/patch-notok/", preview: { id: "patch-notok", sha: "deadbeef" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => usePreviewPatch("node-1"));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("swallows a patches fetch rejection and falls back to {}", async () => {
    dataSourceValue = { base: "/api/preview/patch-reject/", preview: { id: "patch-reject", sha: "deadbeef" } };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const { result } = renderHook(() => usePreviewPatch("node-1"));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("caches the patches promise per base+key across multiple hook instances", async () => {
    dataSourceValue = { base: "/api/preview/shared-base/", preview: { id: "shared-base", sha: "deadbeef" } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ "node-1": [] }) });
    vi.stubGlobal("fetch", fetchMock);

    const { result: r1 } = renderHook(() => usePreviewPatch("node-1"));
    const { result: r2 } = renderHook(() => usePreviewPatch("node-1"));
    await waitFor(() => expect(r1.current).not.toBeNull());
    await waitFor(() => expect(r2.current).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
