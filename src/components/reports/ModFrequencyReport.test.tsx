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
  edited: node("edited", "A.2.1", "Edited Doc", "Article"),
  fresh: node("fresh", "A.2.2", "Never Touched Doc", "Article"),
  // No scope node for "NR", so sectionTitle falls back to the section itself —
  // exercises the sectionTitle === section branch in ModFrequencyTable's Section cell.
  nr: node("nr", "NR-1", "Open Question", "Needed Research"),
};

const COUNTS: ModCount[] = [{ docId: "edited", count: 3, lastModified: "2026-01-05", contentCount: 5 }];

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
  it("renders docs least-modified first, grouped by section", async () => {
    render(<ModFrequencyReport query="" mode="broad" />);
    expect(screen.getByText("loading…")).toBeInTheDocument();

    expect(await screen.findByText("Never Touched Doc")).toBeInTheDocument();
    expect(screen.getByText("Edited Doc")).toBeInTheDocument();
    // "never" applies to the scope, fresh, and nr docs (none has a count row).
    expect(screen.getAllByText("never")).toHaveLength(3);
    expect(screen.getByText("2026-01-05")).toBeInTheDocument();
    expect(screen.getByText("4 documents")).toBeInTheDocument();
  });

  it("switches grouping via the pills", async () => {
    render(<ModFrequencyReport query="" mode="broad" />);
    await screen.findByText("Edited Doc");
    fireEvent.click(screen.getByText("doc type"));
    expect(await screen.findByRole("heading", { name: /Article \(2\)/ })).toBeInTheDocument();
  });

  it("filters rows by the query prop", async () => {
    render(<ModFrequencyReport query="never touched" mode="broad" />);
    // The title gets split across <mark> nodes once highlighted, so match on
    // the row's doc no (unaffected by this query) instead.
    expect(await screen.findByText("A.2.2")).toBeInTheDocument();
    expect(screen.queryByText("A.2.1")).not.toBeInTheDocument();
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
    await screen.findByText("Edited Doc");
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
    await screen.findByText("Edited Doc");
    expect(capturedBase).toBe("/api/preview/abc123/");
  });
});
