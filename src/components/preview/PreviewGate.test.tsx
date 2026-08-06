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
    render(<PreviewGate id="pull-88" routerBase="/preview/pull-88" />);
    expect(screen.getByText("Preparing preview Sky Atlas for PR #88…")).toBeTruthy();
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

  it("maps unavailable to a retry-shortly message", () => {
    render(<PreviewGate id="pr-88" routerBase="/preview/pr-88" />);
    emit({ phase: "failed", code: "unavailable" });
    expect(screen.getByText("The access check is temporarily unavailable — try again shortly.")).toBeTruthy();
  });
});

describe("PreviewGate access-failure screens (private previews)", () => {
  let originalLocation: Location;
  beforeEach(() => {
    originalLocation = window.location;
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { value: originalLocation, writable: true });
  });

  it("shows a Sign in with GitHub button on auth-required and stashes the return path on click", () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/preview/pr-88", search: "", href: "" },
      writable: true,
    });
    render(<PreviewGate id="pr-88" routerBase="/preview/pr-88" />);
    emit({ phase: "failed", code: "auth-required" });
    expect(screen.getByText(/sign in with GitHub to view it/)).toBeTruthy();

    const btn = screen.getByRole("button", { name: "Sign in with GitHub" });
    btn.click();
    expect(sessionStorage.getItem("redline:auth-return")).toBe("/preview/pr-88");
    expect(window.location.href).toBe("/api/auth/github");
  });

  it("shows forbidden copy with no action button", () => {
    render(<PreviewGate id="pr-88" routerBase="/preview/pr-88" />);
    emit({ phase: "failed", code: "forbidden" });
    expect(screen.getByText("You don't have access to this repository.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows app-not-installed copy with an install link when the message is a URL", () => {
    render(<PreviewGate id="pr-88" routerBase="/preview/pr-88" />);
    emit({
      phase: "failed",
      code: "app-not-installed",
      message: "https://github.com/apps/redlens/installations/new",
    });
    expect(screen.getByText(/RedLens app isn't installed/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Install the app ↗" });
    expect(link.getAttribute("href")).toBe("https://github.com/apps/redlens/installations/new");
  });

  it("shows app-not-installed copy with no install link when there's no message", () => {
    render(<PreviewGate id="pr-88" routerBase="/preview/pr-88" />);
    emit({ phase: "failed", code: "app-not-installed" });
    expect(screen.getByText(/RedLens app isn't installed/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Install the app ↗" })).toBeNull();
  });
});
