// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup, act, waitFor } from "@testing-library/react";

const loadHealth = vi.fn();
vi.mock("../lib/health", () => ({
  loadHealth: (...a: unknown[]) => loadHealth(...a),
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const cb of this.listeners[type] ?? []) cb({ data: JSON.stringify(data) } as MessageEvent);
  }
}

beforeEach(() => {
  vi.resetModules();
  loadHealth.mockReset();
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useAtlasVersion", () => {
  it("does nothing (no EventSource, no fetch) when loadedCommit is null", async () => {
    const { useAtlasVersion } = await import("./useAtlasVersion");
    renderHook(() => useAtlasVersion(null));
    expect(loadHealth).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("starts with needsUpdate=false and opens an EventSource + mount health check", async () => {
    loadHealth.mockResolvedValue({ atlas_sha: "sha-current" });
    const { useAtlasVersion } = await import("./useAtlasVersion");
    const { result } = renderHook(() => useAtlasVersion("sha-current"));
    expect(result.current).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/atlas-events");
  });

  it("sets needsUpdate when the mount health check returns a different sha", async () => {
    loadHealth.mockResolvedValue({ atlas_sha: "sha-newer" });
    const { useAtlasVersion } = await import("./useAtlasVersion");
    const { result } = renderHook(() => useAtlasVersion("sha-current"));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("tolerates a rejected health fetch", async () => {
    loadHealth.mockRejectedValue(new Error("network"));
    const { useAtlasVersion } = await import("./useAtlasVersion");
    const { result } = renderHook(() => useAtlasVersion("sha-current"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(false);
  });

  it("sets needsUpdate on an SSE atlas-update event with a different sha", async () => {
    loadHealth.mockResolvedValue({ atlas_sha: "sha-current" });
    const { useAtlasVersion } = await import("./useAtlasVersion");
    const { result } = renderHook(() => useAtlasVersion("sha-current"));
    const es = FakeEventSource.instances[0];
    act(() => {
      es.emit("atlas-update", { atlas_sha: "sha-newer" });
    });
    expect(result.current).toBe(true);
  });

  it("ignores an SSE event carrying the same sha", async () => {
    loadHealth.mockResolvedValue({ atlas_sha: "sha-current" });
    const { useAtlasVersion } = await import("./useAtlasVersion");
    const { result } = renderHook(() => useAtlasVersion("sha-current"));
    const es = FakeEventSource.instances[0];
    act(() => {
      es.emit("atlas-update", { atlas_sha: "sha-current" });
    });
    expect(result.current).toBe(false);
  });

  it("ignores malformed SSE event data", async () => {
    loadHealth.mockResolvedValue({ atlas_sha: "sha-current" });
    const { useAtlasVersion } = await import("./useAtlasVersion");
    const { result } = renderHook(() => useAtlasVersion("sha-current"));
    const es = FakeEventSource.instances[0];
    act(() => {
      for (const cb of es.listeners["atlas-update"] ?? []) {
        cb({ data: "not json" } as MessageEvent);
      }
    });
    expect(result.current).toBe(false);
  });

  it("closes the EventSource on error if it never opened", async () => {
    loadHealth.mockResolvedValue({ atlas_sha: "sha-current" });
    const { useAtlasVersion } = await import("./useAtlasVersion");
    renderHook(() => useAtlasVersion("sha-current"));
    const es = FakeEventSource.instances[0];
    act(() => {
      es.onerror?.();
    });
    expect(es.closed).toBe(true);
  });

  it("does not close the EventSource on error after it has opened", async () => {
    loadHealth.mockResolvedValue({ atlas_sha: "sha-current" });
    const { useAtlasVersion } = await import("./useAtlasVersion");
    renderHook(() => useAtlasVersion("sha-current"));
    const es = FakeEventSource.instances[0];
    act(() => {
      es.onopen?.();
      es.onerror?.();
    });
    expect(es.closed).toBe(false);
  });

  it("closes the EventSource on unmount", async () => {
    loadHealth.mockResolvedValue({ atlas_sha: "sha-current" });
    const { useAtlasVersion } = await import("./useAtlasVersion");
    const { unmount } = renderHook(() => useAtlasVersion("sha-current"));
    const es = FakeEventSource.instances[0];
    unmount();
    expect(es.closed).toBe(true);
  });

  it("re-opens a new EventSource when loadedCommit changes", async () => {
    loadHealth.mockResolvedValue({ atlas_sha: "sha-current" });
    const { useAtlasVersion } = await import("./useAtlasVersion");
    const { rerender } = renderHook(({ commit }) => useAtlasVersion(commit), {
      initialProps: { commit: "sha-a" as string | null },
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    rerender({ commit: "sha-b" });
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});
