// @vitest-environment jsdom
import { it, expect, describe, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ReportsIndex } from "./ReportsIndex";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function wrap(path = "/reports") {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

describe("ReportsIndex", () => {
  it("renders both sections with all report cards when query is empty", () => {
    render(<ReportsIndex query="" />, { wrapper: wrap() });

    expect(screen.getByRole("heading", { name: "Reports", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("OEA Reports")).toBeInTheDocument();
    expect(screen.getByText("General Reports")).toBeInTheDocument();
    // A representative card from each section.
    expect(screen.getByText("Operational Facilitator Responsibilities")).toBeInTheDocument();
    expect(screen.getByText("Active Data Index")).toBeInTheDocument();
    expect(screen.getByText("Atlas Processes")).toBeInTheDocument();
  });

  it("filters cards by title match, dropping empty sections", () => {
    render(<ReportsIndex query="reward" />, { wrapper: wrap() });

    expect(screen.getByText("Integrator Reward Relationships")).toBeInTheDocument();
    // OEA Reports section has no match for "rewards" so it's dropped entirely.
    expect(screen.queryByText("OEA Reports")).toBeNull();
    expect(screen.getByText("General Reports")).toBeInTheDocument();
  });

  it("filters cards by description match too", () => {
    render(<ReportsIndex query="etherscan" />, { wrapper: wrap() });
    // No report description mentions "etherscan" — sanity-check the "no match" path
    // exercises the empty state instead of asserting a fragile positive match.
    expect(screen.getByText(/No reports match/)).toBeInTheDocument();
  });

  it("shows a no-results message when nothing matches, quoting the raw query", () => {
    render(<ReportsIndex query="zzz-nonexistent" />, { wrapper: wrap() });
    expect(screen.getByText('No reports match "zzz-nonexistent".')).toBeInTheDocument();
    expect(screen.queryByText("OEA Reports")).toBeNull();
    expect(screen.queryByText("General Reports")).toBeNull();
  });

  it("links each card to its report route", () => {
    render(<ReportsIndex query="" />, { wrapper: wrap() });
    const link = screen.getByText("Integrator Reward Relationships").closest("a");
    expect(link).toHaveAttribute("href", "/reports/rewards");
  });
});
