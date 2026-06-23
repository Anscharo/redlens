// @vitest-environment jsdom
// PreviewGate is the SSE-driven build state machine. Its pre-ready phases
// (resolving → fetching → building → failed) are what we can exercise in jsdom;
// the "ready" branch mounts the full <App/> and belongs to L3. We drive a
// MockEventSource and assert the interstitial text and error mapping.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

// The "ready" branch mounts the full <App/>, whose import graph pulls the
// vite-plugin-pwa virtual module (absent in vitest). Stub App — these tests only
// cover the pre-ready/failed phases, which never reach it.
vi.mock("../../App", () => ({ default: () => <div data-testid="app" /> }));

import { PreviewGate } from "./PreviewGate";
import { installMockEventSource, MockEventSource } from "../../test/mocks";

let restore: () => void;
beforeEach(() => {
  restore = installMockEventSource();
});
afterEach(() => {
  cleanup();
  restore();
});

function emit(payload: Record<string, unknown>) {
  act(() => MockEventSource.last().emit("preview", payload));
}

describe("PreviewGate phase rendering", () => {
  it("opens an SSE connection to the preview events endpoint for the id", () => {
    render(<PreviewGate id="pr-88" routerBase="/preview/pr-88" />);
    expect(MockEventSource.last().url).toContain("api/preview/pr-88/events");
  });

  it("shows the resolving interstitial before any event arrives", () => {
    render(<PreviewGate id="pr-88" routerBase="/preview/pr-88" />);
    expect(screen.getByText("Preparing preview Sky Atlas…")).toBeTruthy();
    expect(screen.getByText("Resolving…")).toBeTruthy();
  });

  it("advances the interstitial text through fetching and building", () => {
    render(<PreviewGate id="pr-88" routerBase="/preview/pr-88" />);
    emit({ phase: "fetching" });
    expect(screen.getByText("Fetching the proposed atlas…")).toBeTruthy();
    emit({ phase: "building", sha: "abc123" });
    expect(screen.getByText("Building preview…")).toBeTruthy();
  });
});

describe("PreviewGate failure handling", () => {
  it("maps a known error code to its message and closes the stream", () => {
    render(<PreviewGate id="pr-88" routerBase="/preview/pr-88" />);
    const es = MockEventSource.last();
    emit({ phase: "failed", code: "not-found" });
    expect(screen.getByText("No such PR, branch, or pinned commit.")).toBeTruthy();
    expect(es.closed).toBe(true);
  });

  it("falls back to a generic message for an unknown error code", () => {
    render(<PreviewGate id="pr-88" routerBase="/preview/pr-88" />);
    emit({ phase: "failed", code: "wat" });
    expect(screen.getByText("Preview failed.")).toBeTruthy();
  });

  it("treats an SSE transport error before ready as a failure", () => {
    render(<PreviewGate id="pr-88" routerBase="/preview/pr-88" />);
    act(() => MockEventSource.last().emitError());
    expect(screen.getByText("Preview failed.")).toBeTruthy();
  });
});
