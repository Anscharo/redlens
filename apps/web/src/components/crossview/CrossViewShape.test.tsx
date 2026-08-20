// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { CrossViewData } from "../../lib/crossview";
import { atlasHref } from "@/lib/routes";

const track = vi.fn();
vi.mock("../../lib/analytics", () => ({ track: (...args: unknown[]) => track(...args) }));

const downloadCSV = vi.fn();
vi.mock("../../lib/csvDownload", () => ({ downloadCSV: (...args: unknown[]) => downloadCSV(...args) }));

import { CrossViewShape } from "./CrossViewShape";

function wrap() {
  const { hook } = memoryLocation({ path: "/reports/crossview/shape", record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

afterEach(cleanup);
beforeEach(() => {
  track.mockClear();
  downloadCSV.mockClear();
});

const DATA: CrossViewData = {
  atlasCommit: "abcdef1234567890",
  totals: { docs: 10780, bytes: 2048 * 1024, glossaryTerms: 42 },
  docTypes: [
    ["Core", 500],
    ["Section", 300],
  ],
  scopeTree: [{ id: "scope-a", doc_no: "A.1", title: "Governance", docs: 4000 }],
  chunkTree: [
    {
      id: "group-a",
      title: "Agent artifacts",
      docs: 7459,
      children: [{ id: "kid", doc_no: "A.6.1", title: "Prime list", docs: 7447 }],
    },
    { title: "Accessibility", doc_no: "A.5", docs: 24 },
  ],
  neededResearch: [{ id: "nr-1", doc_no: "NR-1", title: "Open research question" }],
};

describe("CrossViewShape", () => {
  it("renders the header stats line", () => {
    render(<CrossViewShape data={DATA} />, { wrapper: wrap() });
    expect(screen.getByText(/10,780 docs/)).toBeInTheDocument();
    expect(screen.getByText(/2048 KB of content/)).toBeInTheDocument();
    expect(screen.getByText(/42 glossary terms/)).toBeInTheDocument();
    expect(screen.getByText(/atlas abcdef1/)).toBeInTheDocument();
  });

  it("renders all five section headings", () => {
    render(<CrossViewShape data={DATA} />, { wrapper: wrap() });
    for (const heading of ["Chunk map", "Doc mass by scope", "Chunk tree", "Overlay chunks", "Needed Research"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
  });

  it("lists overlay doc types with their counts", () => {
    render(<CrossViewShape data={DATA} />, { wrapper: wrap() });
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("Section")).toBeInTheDocument();
    expect(screen.getByText("300")).toBeInTheDocument();
  });

  it("links each needed-research item to its atlas node", () => {
    render(<CrossViewShape data={DATA} />, { wrapper: wrap() });
    const link = screen.getByRole("link", { name: /Open research question/ });
    expect(link).toHaveAttribute("href", atlasHref("nr-1"));
  });

  it("downloads the chunk tree as CSV via the DownloadCsvButton, matching crossviewChunksToCSV", () => {
    render(<CrossViewShape data={DATA} />, { wrapper: wrap() });
    const button = screen.getByRole("button", { name: "Download full report" });
    fireEvent.click(button);
    expect(track).toHaveBeenCalledWith("report_export", {
      report: "crossview",
      format: "csv",
      row_count: 3, // 2 chunkTree roots + 1 child, flattened depth-first
      scope: "full",
    });
    expect(downloadCSV).toHaveBeenCalledTimes(1);
    const [, csv] = downloadCSV.mock.calls[0];
    expect(csv).toContain("Agent artifacts");
    expect(csv).toContain("Prime list");
    expect(csv).toContain("Accessibility");
  });
});
