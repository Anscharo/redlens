// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { RouteErrorBoundary } from "./RouteErrorBoundary";

vi.mock("../lib/analytics", () => ({ captureException: vi.fn() }));

let shouldThrow = true;
function Page() {
  if (shouldThrow) throw new Error("boom");
  return <p>page</p>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  shouldThrow = true;
});

describe("RouteErrorBoundary", () => {
  it("shows the page-failed message for an ordinary error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { hook } = memoryLocation({ path: "/a" });
    render(<Router hook={hook}><RouteErrorBoundary><Page /></RouteErrorBoundary></Router>);
    expect(screen.getByText("page failed to load")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("clears the error when the route changes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { hook, navigate } = memoryLocation({ path: "/a" });
    render(<Router hook={hook}><RouteErrorBoundary><Page /></RouteErrorBoundary></Router>);
    shouldThrow = false;
    act(() => navigate("/b"));
    expect(screen.getByText("page")).toBeInTheDocument();
  });
});
