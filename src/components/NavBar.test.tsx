// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { NavBar } from "./NavBar";
import { DataSourceContext, DEFAULT_SOURCE, type DataSource } from "../lib/dataSource";

afterEach(() => {
  cleanup();
});

function wrap(source: DataSource = DEFAULT_SOURCE) {
  const { hook } = memoryLocation({ path: "/", record: true });
  return ({ children }: { children: React.ReactNode }) => (
    <Router hook={hook}>
      <DataSourceContext.Provider value={source}>{children}</DataSourceContext.Provider>
    </Router>
  );
}

describe("NavBar", () => {
  it("renders Reader, Radar, and Reports links when not in preview", () => {
    render(<NavBar activePage="atlas" />, { wrapper: wrap() });
    expect(screen.getByRole("link", { name: "Reader" })).toHaveAttribute("href", "/atlas");
    expect(screen.getByRole("link", { name: "Radar" })).toHaveAttribute("href", "/radar");
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("href", "/reports");
  });

  it("marks the active page via data-active", () => {
    render(<NavBar activePage="radar" />, { wrapper: wrap() });
    expect(screen.getByRole("link", { name: "Radar" })).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("link", { name: "Reader" })).not.toHaveAttribute("data-active");
  });

  it("renders no active markers when activePage is null", () => {
    render(<NavBar activePage={null} />, { wrapper: wrap() });
    expect(screen.getByRole("link", { name: "Reader" })).not.toHaveAttribute("data-active");
    expect(screen.getByRole("link", { name: "Radar" })).not.toHaveAttribute("data-active");
  });

  it("hides the Reports link in preview mode", () => {
    render(<NavBar activePage="atlas" />, {
      wrapper: wrap({ base: "/api/preview/abc/", preview: { id: "abc", sha: "deadbeef" } }),
    });
    expect(screen.getByRole("link", { name: "Reader" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Reports" })).toBeNull();
  });
});
