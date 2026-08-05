// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import type { AtlasNode } from "../../types";
import type { ModCount } from "../../lib/history";
import { DataSourceContext, type DataSource } from "../../lib/dataSource";

function node(id: string, doc_no: string, title: string, type = "Section"): AtlasNode {
  return { id, doc_no, title, type, depth: 1, parentId: null, content: "", order: 0, addressRefs: [] };
}

const DOCS: Record<string, AtlasNode> = {
  scope: node("scope", "A.2", "Accessibility Scope", "Scope"),
  // Excluded from the doc-level list (count > 1) but still counted in the
  // A.2 category's summary total (4 docs, 2 of them never modified).
  edited: node("edited", "A.2.1", "Edited Doc", "Article"),
  fresh: node("fresh", "A.2.2", "Never Touched Doc", "Article"),
  // Boundary case: count === 1 stays in the (≤1) doc-level list.
  once: node("once", "A.2.3", "Once Edited Doc", "Article"),
  // No scope node for "NR", so sectionTitle falls back to the section itself —
  // exercises the sectionTitle === section branch in ModFrequencyTable's Section cell.
  nr: node("nr", "NR-1", "Open Question", "Needed Research"),
  // Heavily-edited docs, isolated in their own section so they don't disturb
  // the A.2/NR summary percentages above. Only used by the frequent-mode tests.
  busy1: node("busy1", "A.9.1", "Busy Doc One", "Article"),
  busy2: node("busy2", "A.9.2", "Busy Doc Two", "Article"),
};

const COUNTS: ModCount[] = [
  { docId: "edited", count: 3, lastModified: "2026-01-05", contentCount: 5 },
  { docId: "once", count: 1, lastModified: "2025-11-01", contentCount: 1 },
  { docId: "busy1", count: 5, lastModified: "2026-02-01", contentCount: 5 },
  { docId: "busy2", count: 8, lastModified: "2026-03-01", contentCount: 8 },
];

let docsImpl = () => Promise.resolve(DOCS);
let countsImpl = (): Promise<ModCount[] | null> => Promise.resolve(COUNTS);
let capturedBase: string | null = null;

vi.mock("../../lib/docs", () => ({
  loadDocs: (base?: string) => {
    capturedBase = base ?? null;
    return docsImpl();
  },
}));
vi.mock("../../lib/history", () => ({
  loadModCounts: () => countsImpl(),
}));

import { ModFrequencyReport } from "./ModFrequencyReport";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
  docsImpl = () => Promise.resolve(DOCS);
  countsImpl = () => Promise.resolve(COUNTS);
  capturedBase = null;
  vi.restoreAllMocks();
});

describe("ModFrequencyReport", () => {
  it("summarizes zero-modification docs per category against the category's full total", async () => {
    render(<ModFrequencyReport query="" mode="broad" />);
    expect(screen.getByText("loading…")).toBeInTheDocument();

    // A.2 category: scope, edited, fresh, once = 4 docs; scope + fresh never
    // modified = 2/4 = 50%. "edited" (count 3) still counts toward the total
    // even though it's excluded from the doc-level list below.
    expect(await screen.findByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("100.0%")).toBeInTheDocument(); // NR: 1/1 never modified
  });

  it("shows only docs with ≤1 modification in the doc-level list, excluding more-edited docs", async () => {
    render(<ModFrequencyReport query="" mode="broad" />);
    expect(await screen.findByText("Never Touched Doc")).toBeInTheDocument();
    expect(screen.getByText("Once Edited Doc")).toBeInTheDocument();
    expect(screen.queryByText("Edited Doc")).not.toBeInTheDocument();
    expect(screen.getByText("4 documents with ≤1 modification")).toBeInTheDocument();
  });

  it("renders a distribution histogram of documents by edit count", async () => {
    render(<ModFrequencyReport query="" mode="broad" />);
    await screen.findByText("Never Touched Doc");
    expect(screen.getByText("Documents by number of edits")).toBeInTheDocument();
    // Buckets 0..8 (max count is busy2's 8), well under the 20-bucket tail cap.
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("switches to frequent mode and lists docs above the top-N% threshold", async () => {
    render(<ModFrequencyReport query="" mode="broad" />);
    await screen.findByText("Never Touched Doc");
    fireEvent.click(screen.getByText("frequently modified"));
    expect(await screen.findByText("Busy Doc Two")).toBeInTheDocument();
    expect(screen.queryByText("Busy Doc One")).not.toBeInTheDocument();
    expect(screen.queryByText("Never Touched Doc")).not.toBeInTheDocument();
    expect(screen.getByText(/documents with more than 5 modifications \(top 20%\)/)).toBeInTheDocument();
  });

  it("switches grouping via the pills (section/type only, no flat list)", async () => {
    render(<ModFrequencyReport query="" mode="broad" />);
    await screen.findByText("Never Touched Doc");
    expect(screen.queryByText("flat list")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("doc type"));
    expect(await screen.findByRole("heading", { name: /Article \(2\)/ })).toBeInTheDocument();
  });

  it("filters the doc-level list by the query prop", async () => {
    render(<ModFrequencyReport query="never touched" mode="broad" />);
    // The title gets split across <mark> nodes once highlighted, so match on
    // the row's doc no (unaffected by this query) instead.
    expect(await screen.findByText("A.2.2")).toBeInTheDocument();
    expect(screen.queryByText("A.2.3")).not.toBeInTheDocument();
  });

  it("shows NoRowsMatch when a query matches nothing", async () => {
    render(<ModFrequencyReport query="zzz-no-match-at-all" mode="broad" />);
    expect(await screen.findByText(/No rows match/)).toBeInTheDocument();
  });

  it("shows a warning when the history DB is unreachable on this deploy", async () => {
    countsImpl = () => Promise.resolve(null);
    render(<ModFrequencyReport query="" mode="broad" />);
    expect(await screen.findByText(/isn't reachable on this deploy/)).toBeInTheDocument();
  });

  it("builds and downloads a CSV when the download button is clicked", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    render(<ModFrequencyReport query="" mode="broad" />);
    await screen.findByText("Never Touched Doc");
    fireEvent.click(screen.getByText("Download full report"));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("builds the filtered CSV when the filtered download button is clicked", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    render(<ModFrequencyReport query="never touched" mode="broad" />);
    await screen.findByText("A.2.2");
    fireEvent.click(screen.getByText("Download filtered report"));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("loads docs from the active preview base, not the live atlas base", async () => {
    const previewSource: DataSource = { base: "/api/preview/abc123/", preview: { id: "abc123", sha: "abc123" } };
    render(
      <DataSourceContext.Provider value={previewSource}>
        <ModFrequencyReport query="" mode="broad" />
      </DataSourceContext.Provider>,
    );
    await screen.findByText("Never Touched Doc");
    expect(capturedBase).toBe("/api/preview/abc123/");
  });
});
