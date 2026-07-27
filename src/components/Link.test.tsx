// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { Link } from "./Link";

afterEach(() => {
  cleanup();
});

function wrap(path = "/") {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

function LocationProbe() {
  const [loc] = useLocation();
  return <p>current: {loc}</p>;
}

describe("Link", () => {
  it("renders an anchor with the resolved href", () => {
    render(<Link to="/reports">Reports</Link>, { wrapper: wrap("/") });
    const a = screen.getByRole("link", { name: "Reports" });
    expect(a).toHaveAttribute("href", "/reports");
  });

  it("navigates in-SPA on a plain left click", () => {
    const Wrapper = wrap("/");
    render(
      <Wrapper>
        <Link to="/reports">Reports</Link>
        <LocationProbe />
      </Wrapper>,
    );
    expect(screen.getByText("current: /")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Reports" }), { button: 0 });
    expect(screen.getByText("current: /reports")).toBeInTheDocument();
  });

  it("does not navigate when a modifier key is held", () => {
    const Wrapper = wrap("/");
    render(
      <Wrapper>
        <Link to="/reports">Reports</Link>
        <LocationProbe />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Reports" }), { button: 0, metaKey: true });
    expect(screen.getByText("current: /")).toBeInTheDocument();
  });

  it("does not navigate on a non-primary mouse button", () => {
    const Wrapper = wrap("/");
    render(
      <Wrapper>
        <Link to="/reports">Reports</Link>
        <LocationProbe />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Reports" }), { button: 1 });
    expect(screen.getByText("current: /")).toBeInTheDocument();
  });

  it("calls a user-supplied onClick handler before deciding to navigate", () => {
    const onClick = vi.fn();
    render(<Link to="/reports" onClick={onClick}>Reports</Link>, { wrapper: wrap("/") });
    fireEvent.click(screen.getByRole("link", { name: "Reports" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("respects a user handler that calls preventDefault (no navigation)", () => {
    const Wrapper = wrap("/");
    render(
      <Wrapper>
        <Link to="/reports" onClick={(e) => e.preventDefault()}>Reports</Link>
        <LocationProbe />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Reports" }));
    expect(screen.getByText("current: /")).toBeInTheDocument();
  });
});
