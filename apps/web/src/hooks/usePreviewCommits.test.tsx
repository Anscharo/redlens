// @vitest-environment jsdom
// usePreviewCommits: the stream opens only while the toggle is on and a preview
// is loaded, folds each event into the state, and closes on the last event, on
// a dropped connection, and when the document changes.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

import { DataSourceContext } from "../lib/dataSource";
import type { PreviewCommit } from "@/lib/previewCommits";
import { usePreviewCommits } from "./usePreviewCommits";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
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
  emit(data: unknown) {
    act(() => {
      for (const cb of this.listeners.commits ?? []) cb({ data: JSON.stringify(data) } as MessageEvent);
    });
  }
}

const PREVIEW = { base: "/api/preview/abc/", preview: { id: "o/r@b", sha: "abc" } };
const wrapper = ({ children }: { children: ReactNode }) => (
  <DataSourceContext.Provider value={PREVIEW}>{children}</DataSourceContext.Provider>
);
const commit = (sha: string): PreviewCommit => ({ sha, parents: [], date: "2026-10-01T00:00:00Z", author: "a", message: sha, merge: false, entries: [] });
const latest = () => FakeEventSource.instances.at(-1)!;

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource;
});
afterEach(cleanup);

describe("usePreviewCommits", () => {
  it("opens nothing while the toggle is off", () => {
    const { result } = renderHook(() => usePreviewCommits("n1", "repo", false), { wrapper });
    expect(result.current).toBeNull();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("streams range, commits and done into the state, then closes", () => {
    const { result } = renderHook(() => usePreviewCommits("n1", "repo", true), { wrapper });
    expect(latest().url).toBe("/api/preview/abc/commits?base=repo&uuid=n1");
    expect(result.current?.phase).toBe("connecting");
    latest().emit({ type: "range", total: 5, walking: 2 });
    latest().emit({ type: "fetching", phase: "Receiving objects", loaded: 1, total: 9 });
    expect(result.current).toMatchObject({ phase: "fetching", total: 5, walking: 2 });
    latest().emit({ type: "commit", index: 0, commit: commit("c2") });
    expect(result.current?.phase).toBe("walking");
    latest().emit({ type: "commit", index: 1, commit: commit("c1") });
    latest().emit({ type: "done", truncated: true });
    expect(result.current).toMatchObject({ phase: "done", truncated: true });
    expect(result.current?.commits.map((c) => c.sha)).toEqual(["c2", "c1"]);
    expect(latest().closed).toBe(true);
  });

  it("a dropped connection is an error, and the stream is not reopened", () => {
    const { result } = renderHook(() => usePreviewCommits("n1", "sky", true), { wrapper });
    act(() => latest().onerror?.());
    expect(result.current).toMatchObject({ phase: "error", error: "failed" });
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("a diff base with no merge base is unavailable without a request", () => {
    const { result } = renderHook(() => usePreviewCommits("n1", null, true), { wrapper });
    expect(result.current).toMatchObject({ phase: "error", error: "unavailable" });
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("waits while the diff base is still resolving, then streams against it", () => {
    const { result, rerender } = renderHook(({ base }) => usePreviewCommits("n1", base, true), {
      wrapper,
      initialProps: { base: undefined as "repo" | null | undefined },
    });
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current?.phase).toBe("connecting");
    rerender({ base: "repo" });
    expect(latest().url).toBe("/api/preview/abc/commits?base=repo&uuid=n1");
  });

  it("a frame that does not parse ends the stream as failed", () => {
    const { result } = renderHook(() => usePreviewCommits("n1", "repo", true), { wrapper });
    act(() => {
      for (const cb of latest().listeners.commits ?? []) cb({ data: "{not json" } as MessageEvent);
    });
    expect(result.current).toMatchObject({ phase: "error", error: "failed" });
    expect(latest().closed).toBe(true);
  });

  it("another document closes the old stream and starts fresh", () => {
    const { result, rerender } = renderHook(({ id }) => usePreviewCommits(id, "repo", true), { wrapper, initialProps: { id: "n1" } });
    const first = latest();
    first.emit({ type: "commit", index: 0, commit: commit("c1") });
    rerender({ id: "n2" });
    expect(first.closed).toBe(true);
    expect(latest().url).toContain("uuid=n2");
    expect(result.current).toMatchObject({ phase: "connecting", commits: [] });
  });
});
