// @vitest-environment jsdom
import { it, expect, describe, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ReportsIndex } from "./ReportsIndex";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hits: [] }),
    }),
  );
});

function wrap(path = "/reports") {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

describe("ReportsIndex", () => {
  it("renders both sections with all report cards when query is empty", () => {
    render(<ReportsIndex query="" />, { wrapper: wrap() });

    expect(screen.getByRole("heading", { name: "Reports", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "OEA Reports" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "General Reports" })).toBeInTheDocument();
    // A representative card from each section.
    expect(screen.getByRole("link", { name: /Operational Facilitator Responsibilities/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Active Data Index/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Atlas Processes/ })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("filters cards by title match, dropping empty sections", () => {
    render(<ReportsIndex query="reward" />, { wrapper: wrap() });

    expect(screen.getByRole("link", { name: /Integrator Reward Relationships/ })).toBeInTheDocument();
    // OEA Reports section has no match for "rewards" so it's dropped entirely.
    expect(screen.queryByRole("heading", { name: "OEA Reports" })).toBeNull();
    expect(screen.getByRole("heading", { name: "General Reports" })).toBeInTheDocument();
  });

  it("filters cards by description match too", () => {
    render(<ReportsIndex query="csv export" />, { wrapper: wrap() });
    expect(screen.getByRole("link", { name: /Active Data Index/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /On-Chain Addresses/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Integrator Reward Relationships/ })).toBeNull();
  });

  it("a category match keeps every report in that section", () => {
    render(<ReportsIndex query="general" />, { wrapper: wrap() });
    expect(screen.getByRole("heading", { name: "General Reports" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "OEA Reports" })).toBeNull();
    expect(screen.getByRole("link", { name: /Active Data Index/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Atlas CrossView/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Operational Facilitator Responsibilities/ })).toBeNull();
  });

  it("unions server semantic hits with the lexical filter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ hits: ["onchain-addresses"] }),
      }),
    );
    render(<ReportsIndex query="wallet addresses" />, { wrapper: wrap() });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /On-Chain Addresses/ })).toBeInTheDocument();
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/reports/search?q=wallet%20addresses",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("shows a no-results message when nothing matches, quoting the raw query", async () => {
    render(<ReportsIndex query="zzz-nonexistent" />, { wrapper: wrap() });
    await waitFor(() => {
      expect(screen.getByText('No reports match "zzz-nonexistent".')).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "OEA Reports" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "General Reports" })).toBeNull();
  });

  it("links each card to its report route", () => {
    render(<ReportsIndex query="" />, { wrapper: wrap() });
    const link = screen.getByRole("link", { name: /Integrator Reward Relationships/ });
    expect(link).toHaveAttribute("href", "/reports/rewards");
  });
});
