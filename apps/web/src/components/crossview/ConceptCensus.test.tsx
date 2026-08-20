// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { AtlasNode } from "@/types";

const track = vi.fn();
vi.mock("../../lib/analytics", () => ({ track: (...args: unknown[]) => track(...args) }));

const downloadCSV = vi.fn();
vi.mock("../../lib/csvDownload", () => ({ downloadCSV: (...args: unknown[]) => downloadCSV(...args) }));

// loadAtlas is mocked per-base so the base-keyed cache in ConceptCensus.tsx
// can be exercised directly: each distinct base string gets its own call
// count, mirroring how the real loadAtlas is keyed by data-source base.
const loadAtlasCalls = vi.fn();
let loadAtlasImpl: (base: string) => Promise<{ docs: Record<string, AtlasNode> }> = () =>
  Promise.reject(new Error("not configured"));
vi.mock("../../lib/docs", () => ({
  loadAtlas: (base: string) => {
    loadAtlasCalls(base);
    return loadAtlasImpl(base);
  },
}));

const useDataSourceMock = vi.fn();
vi.mock("../../lib/dataSource", () => ({
  useDataSource: (...args: unknown[]) => useDataSourceMock(...args),
}));

import { ConceptCensus } from "./ConceptCensus";

let order = 0;
const mk = (doc_no: string, title: string, content = "x"): AtlasNode => ({
  id: `id-${doc_no}`,
  doc_no,
  title,
  type: "Core",
  depth: 1,
  parentId: null,
  content,
  order: order++,
  addressRefs: [],
});

const docsFixture: Record<string, AtlasNode> = {
  "id-A.9.1": mk("A.9.1", "Foo Transitionary Measure"),
  "id-A.9.2": mk("A.9.2", "Bar Transitionary Measures"),
  "id-A.9.3": mk("A.9.3", "Unrelated Doc"),
};

// ConceptCensus.tsx's loadAtlas cache is keyed by base and lives at module
// scope, so a base reused across tests would silently serve a previous test's
// cached (possibly rejected/stale) promise instead of exercising this test's
// loadAtlasImpl. Minting a fresh base per test keeps them isolated without
// reaching into the module's private cache.
let baseSeq = 0;
const freshBase = () => `/api/test-base-${++baseSeq}/`;

beforeEach(() => {
  track.mockClear();
  downloadCSV.mockClear();
  loadAtlasCalls.mockClear();
  useDataSourceMock.mockReturnValue({ base: freshBase(), preview: null });
  loadAtlasImpl = () => Promise.resolve({ docs: docsFixture });
});

afterEach(cleanup);

describe("ConceptCensus", () => {
  it("shows a loading state before the census resolves", () => {
    let resolve!: (v: { docs: Record<string, AtlasNode> }) => void;
    loadAtlasImpl = () => new Promise((res) => { resolve = res; });
    render(<ConceptCensus slug="transitionary-measures" />);
    expect(screen.getByText(/computing census/)).toBeInTheDocument();
    resolve({ docs: docsFixture });
  });

  it("renders the census title, signature, and count once loaded", async () => {
    render(<ConceptCensus slug="transitionary-measures" />);
    expect(await screen.findByText(/census: Short-Term Transitionary Measures/)).toBeInTheDocument();
    expect(screen.getByText(/title contains "Transitionary Measure\(s\)"/)).toBeInTheDocument();
    expect(screen.getByText(/total: 2/)).toBeInTheDocument();
  });

  it("shows an error state when the atlas bundle fails to load", async () => {
    loadAtlasImpl = () => Promise.reject(new Error("network down"));
    render(<ConceptCensus slug="transitionary-measures" />);
    expect(await screen.findByText(/census failed to load/)).toBeInTheDocument();
  });

  it("shows an unknown-slug message for a slug the census doesn't recognize", async () => {
    render(<ConceptCensus slug="not-a-real-slug" />);
    expect(await screen.findByText(/unknown census slug/)).toBeInTheDocument();
  });

  it("expands to a member list with reader links to each matched doc", async () => {
    render(<ConceptCensus slug="transitionary-measures" />);
    const toggle = await screen.findByRole("button", { name: /Show 2 members/ });
    fireEvent.click(toggle);
    expect(await screen.findByRole("button", { name: /Hide 2 members/ })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "A.9.1" });
    expect(link).toHaveAttribute("href", expect.stringContaining("id-A.9.1"));
    expect(screen.getByRole("link", { name: "A.9.2" })).toBeInTheDocument();
  });

  it("downloads a CSV and tracks the export when the button is clicked", async () => {
    render(<ConceptCensus slug="transitionary-measures" />);
    const button = await screen.findByRole("button", { name: "Download CSV" });
    fireEvent.click(button);
    expect(track).toHaveBeenCalledWith("report_export", {
      report: "crossview-concepts-census-transitionary-measures",
      format: "csv",
      scope: "full",
      row_count: 2,
    });
    expect(downloadCSV).toHaveBeenCalledTimes(1);
    const [filename, csv] = downloadCSV.mock.calls[0];
    expect(filename).toBe("concepts-census-transitionary-measures.csv");
    expect(csv).toContain("id-A.9.1");
    expect(csv).toContain("A.9.1");
  });

  it("keys the loadAtlas cache by data-source base — a preview base fetches independently of the live base", async () => {
    const liveBase = freshBase();
    const previewBase = freshBase();
    useDataSourceMock.mockReturnValue({ base: liveBase, preview: null });
    const { rerender } = render(<ConceptCensus slug="transitionary-measures" />);
    await screen.findByText(/census: Short-Term/);
    rerender(<ConceptCensus slug="transitionary-measures" />);
    await waitFor(() => expect(loadAtlasCalls).toHaveBeenCalledTimes(1)); // cached, no refetch

    useDataSourceMock.mockReturnValue({ base: previewBase, preview: { id: "abc", sha: "deadbeef" } });
    render(<ConceptCensus slug="transitionary-measures" />);
    await waitFor(() => expect(loadAtlasCalls).toHaveBeenCalledTimes(2));
    expect(loadAtlasCalls.mock.calls.map((c) => c[0])).toEqual([liveBase, previewBase]);
  });
});
