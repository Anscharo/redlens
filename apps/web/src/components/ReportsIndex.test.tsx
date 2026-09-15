// @vitest-environment jsdom
import { it, expect, describe, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ReportsIndex } from "./ReportsIndex";
import { REPORT_GROUPS } from "@/lib/reportCatalog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
  });

  it("explains that unbadged reports are rebuilt from the Atlas", () => {
    render(<ReportsIndex query="" />, { wrapper: wrap() });
    expect(screen.getByText(/Unlabelled reports are rebuilt from the Atlas/)).toBeInTheDocument();
  });

  it("badges only the reports that are not rebuilt live", () => {
    render(<ReportsIndex query="" />, { wrapper: wrap() });

    // Curated: hand-maintained, can lag the atlas.
    for (const title of ["Potential Mistakes", "Atlas Processes"]) {
      const card = screen.getByText(title).closest("a")!;
      expect(within(card).getByText("curated")).toBeInTheDocument();
    }
    // AI-assessed: rubric-scored, human-reviewed.
    for (const title of ["OEA Task Assessment", "Risk Rules Assessment"]) {
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

    expect(screen.getByText("Integrator Reward Relationships")).toBeInTheDocument();
    expect(screen.getByText("On-chain & money")).toBeInTheDocument();
    expect(screen.queryByText("Roles & duties")).toBeNull();
    expect(screen.queryByText("Atlas health")).toBeNull();
  });

  it("filters by the badge label, so 'curated' narrows to the hand-maintained reports", () => {
    render(<ReportsIndex query="curated" />, { wrapper: wrap() });

    expect(screen.getByText("Potential Mistakes")).toBeInTheDocument();
    expect(screen.getByText("Atlas Processes")).toBeInTheDocument();
    expect(screen.queryByText("Active Data Index")).toBeNull();
  });

  it("shows a no-results message when nothing matches, quoting the raw query", () => {
    render(<ReportsIndex query="zzz-nonexistent" />, { wrapper: wrap() });
    expect(screen.getByText('No reports match "zzz-nonexistent".')).toBeInTheDocument();
    for (const g of REPORT_GROUPS) expect(screen.queryByText(g.title)).toBeNull();
  });

  it("links each card to its report route", () => {
    render(<ReportsIndex query="" />, { wrapper: wrap() });
    const link = screen.getByText("Integrator Reward Relationships").closest("a");
    expect(link).toHaveAttribute("href", "/reports/rewards");
  });
});
