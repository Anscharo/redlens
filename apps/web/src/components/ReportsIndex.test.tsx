// @vitest-environment jsdom
import { it, expect, describe, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ReportsIndex } from "./ReportsIndex";
import { REPORT_GROUPS } from "@/lib/reportCatalog";

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
  it("renders every subject group with its hint when query is empty", () => {
    render(<ReportsIndex query="" />, { wrapper: wrap() });

    expect(screen.getByRole("heading", { name: "Reports", level: 1 })).toBeInTheDocument();
    for (const g of REPORT_GROUPS) {
      expect(screen.getByText(g.title)).toBeInTheDocument();
      expect(screen.getByText(g.hint)).toBeInTheDocument();
    }
    // A representative card from three different groups.
    expect(screen.getByText("Operational Facilitator Responsibilities")).toBeInTheDocument();
    expect(screen.getByText("Active Data Index")).toBeInTheDocument();
    expect(screen.getByText("Potential Mistakes")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("explains that unbadged reports are rebuilt from the Atlas", () => {
    render(<ReportsIndex query="" />, { wrapper: wrap() });
    expect(screen.getByText(/Unlabelled reports are rebuilt from the Atlas/)).toBeInTheDocument();
  });

  it("badges only the reports that are not rebuilt live", () => {
    render(<ReportsIndex query="" />, { wrapper: wrap() });

    // Curated: hand-maintained, can lag the atlas.
    for (const title of ["Atlas Processes"]) {
      const card = screen.getByText(title).closest("a")!;
      expect(within(card).getByText("curated")).toBeInTheDocument();
    }
    // AI-assessed: model output, human-reviewed — a rubric score for the two
    // assessments, an LLM defect sweep for Potential Mistakes.
    for (const title of ["OEA Task Assessment", "Risk Rules Assessment", "Potential Mistakes"]) {
      const card = screen.getByText(title).closest("a")!;
      expect(within(card).getByText("AI-assessed")).toBeInTheDocument();
    }
    // Live reports carry no badge at all — that is what keeps a badge meaningful.
    const live = screen.getByText("Active Data Index").closest("a")!;
    expect(within(live).queryByText("curated")).toBeNull();
    expect(within(live).queryByText("AI-assessed")).toBeNull();
  });

  it("filters cards by title match, dropping emptied groups", () => {
    render(<ReportsIndex query="reward" />, { wrapper: wrap() });

    expect(screen.getByRole("link", { name: /Integrator Reward Relationships/ })).toBeInTheDocument();
    expect(screen.getByText("On-chain & money")).toBeInTheDocument();
    expect(screen.queryByText("Roles & duties")).toBeNull();
    expect(screen.queryByText("Atlas health")).toBeNull();
  });

  it("filters cards by description match too", () => {
    render(<ReportsIndex query="csv export" />, { wrapper: wrap() });
    expect(screen.getByRole("link", { name: /Active Data Index/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /On-Chain Addresses/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Integrator Reward Relationships/ })).toBeNull();
  });

  it("filters by the badge label, so 'curated' narrows to the hand-maintained reports", () => {
    render(<ReportsIndex query="curated" />, { wrapper: wrap() });

    expect(screen.getByText("Atlas Processes")).toBeInTheDocument();
    expect(screen.queryByText("Potential Mistakes")).toBeNull();
    expect(screen.queryByText("Active Data Index")).toBeNull();
  });

  it("a category match keeps every report in that group", () => {
    render(<ReportsIndex query="atlas health" />, { wrapper: wrap() });
    expect(screen.getByText("Atlas health")).toBeInTheDocument();
    expect(screen.queryByText("Roles & duties")).toBeNull();
    expect(screen.getByRole("link", { name: /Potential Mistakes/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Stale Dates/ })).toBeInTheDocument();
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
    for (const g of REPORT_GROUPS) expect(screen.queryByText(g.title)).toBeNull();
  });

  it("links each card to its report route", () => {
    render(<ReportsIndex query="" />, { wrapper: wrap() });
    const link = screen.getByRole("link", { name: /Integrator Reward Relationships/ });
    expect(link).toHaveAttribute("href", "/reports/rewards");
  });
});
