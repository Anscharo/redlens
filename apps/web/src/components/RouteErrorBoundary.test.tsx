// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { RouteErrorBoundary } from "./RouteErrorBoundary";

vi.mock("../lib/analytics", () => ({ captureException: vi.fn() }));

let shouldThrow = true;
let message = "boom";
function Page() {
  if (shouldThrow) throw new Error(message);
  return <p>page</p>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  shouldThrow = true;
  message = "boom";
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

  it("offers a refresh instead for a stale chunk after a deploy", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    message = "Failed to fetch dynamically imported module: /assets/Page-old.js";
    const { hook } = memoryLocation({ path: "/a" });
    render(<Router hook={hook}><RouteErrorBoundary><Page /></RouteErrorBoundary></Router>);
    expect(screen.getByRole("button", { name: "refresh to update" })).toBeInTheDocument();
    expect(screen.queryByText("page failed to load")).toBeNull();
  });
});
