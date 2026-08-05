// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import type { AtlasNode } from "../../types";
import type { ModCount } from "../../lib/history";
import type { GraphData } from "../../lib/graphData";
import { DataSourceContext, type DataSource } from "../../lib/dataSource";

function node(id: string, doc_no: string, title: string, type = "Section"): AtlasNode {
  return { id, doc_no, title, type, depth: 1, parentId: null, content: "", order: 0, addressRefs: [] };
}

const DOCS: Record<string, AtlasNode> = {
  scope: node("scope", "A.2", "Accessibility Scope", "Scope"),
  // Excluded from the default (≤1) doc-level list but still counted in the
  // A.2 category's summary total.
  edited: node("edited", "A.2.1", "Edited Doc", "Article"),
  fresh: node("fresh", "A.2.2", "Never Touched Doc", "Article"),
  // Boundary case: count === 1 stays in the default (≤1) doc-level list.
  once: node("once", "A.2.3", "Once Edited Doc", "Article"),
  // No scope node for "NR", so sectionTitle falls back to the section itself —
  // exercises the sectionTitle === section branch in ModFrequencyTable's Section cell.
  nr: node("nr", "NR-1", "Open Question", "Needed Research"),
  // Heavily-edited docs, isolated in their own section so they don't disturb
  // the A.2/NR summary percentages above. Only used by the ">" comparator tests.
  busy1: node("busy1", "A.9.1", "Busy Doc One", "Article"),
  busy2: node("busy2", "A.9.2", "Busy Doc Two", "Article"),
};

const COUNTS: ModCount[] = [
  { docId: "edited", count: 3, lastModified: "2026-01-05", contentCount: 5 },
  { docId: "once", count: 1, lastModified: "2025-11-01", contentCount: 1 },
  { docId: "busy1", count: 5, lastModified: "2026-02-01", contentCount: 5 },
  { docId: "busy2", count: 8, lastModified: "2026-03-01", contentCount: 8 },
];

const EMPTY_GRAPH: GraphData = { participants: [], instances: [], invocations: [], primitives: [], edges: [] };

let docsImpl = () => Promise.resolve(DOCS);
let countsImpl = (): Promise<ModCount[] | null> => Promise.resolve(COUNTS);
let graphImpl = (): Promise<GraphData> => Promise.resolve(EMPTY_GRAPH);
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
vi.mock("../../lib/graph", () => ({
  loadGraph: () => graphImpl(),
}));

import { ModFrequencyReport } from "./ModFrequencyReport";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
  docsImpl = () => Promise.resolve(DOCS);
  countsImpl = () => Promise.resolve(COUNTS);
  graphImpl = () => Promise.resolve(EMPTY_GRAPH);
  capturedBase = null;
  vi.restoreAllMocks();
});

describe("ModFrequencyReport", () => {
  it("summarizes docs matching the active filter per category against the category's full total", async () => {
    render(<ModFrequencyReport query="" mode="broad" />);
    expect(screen.getByText("loading…")).toBeInTheDocument();

    // A.2 category: scope, edited, fresh, once = 4 docs; default filter is
    // ≤1 modification, matching scope(0)/fresh(0)/once(1) = 3/4 = 75%.
    // "edited" (count 3) still counts toward the total even though it's
    // excluded from the doc-level list below.
    expect(await screen.findByText("75.0%")).toBeInTheDocument();
    expect(screen.getByText("100.0%")).toBeInTheDocument(); // NR: nr(0) matches, 1/1
    expect(screen.getByText("≤1 modification")).toBeInTheDocument(); // column header names the filter
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

  it("switches to 'Most Frequent' and lists docs above the typed threshold, updating the summary table too", async () => {
    render(<ModFrequencyReport query="" mode="broad" />);
    await screen.findByText("Never Touched Doc");
    fireEvent.click(screen.getByText("Most Frequent (>1 edit)"));
    // Default threshold is still 1: count > 1 keeps edited(3), busy1(5), busy2(8).
    expect(await screen.findByText("Busy Doc Two")).toBeInTheDocument();
    expect(screen.getByText("Busy Doc One")).toBeInTheDocument();
    expect(screen.getByText("Edited Doc")).toBeInTheDocument();
    expect(screen.queryByText("Never Touched Doc")).not.toBeInTheDocument();
    expect(screen.getByText(/documents with >1 modification/)).toBeInTheDocument();
    expect(screen.getByText(">1 modification")).toBeInTheDocument(); // summary column header follows the filter
    // Pill label bakes in the live threshold too.
    expect(screen.getByText("Least Frequent (≤1 edit)")).toBeInTheDocument();

    // Raise the threshold via the number input: only busy1/busy2 (>4) remain.
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.blur(input);
    expect(await screen.findByText(/documents with >4 modifications/)).toBeInTheDocument();
    expect(screen.queryByText("Edited Doc")).not.toBeInTheDocument();
    expect(screen.getByText("Busy Doc One")).toBeInTheDocument();
    expect(screen.getByText("Most Frequent (>4 edits)")).toBeInTheDocument();
  });

  it("clamps the threshold input to [1, 12] and reverts on invalid entry", async () => {
    render(<ModFrequencyReport query="" mode="broad" />);
    await screen.findByText("Never Touched Doc");
    const input = screen.getByRole("spinbutton");

    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.blur(input);
    expect(await screen.findByDisplayValue("12")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(await screen.findByDisplayValue("12")).toBeInTheDocument(); // reverts to last committed value
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

  it("sub-splits the A.6 Agent Scope by owning agent when the graph resolves one", async () => {
    const agentDocs: Record<string, AtlasNode> = {
      ...DOCS,
      agentScope: node("agentScope", "A.6", "The Agent Scope", "Scope"),
      sparkRoot: node("sparkRoot", "A.6.1.1.1", "Spark", "Core"),
      sparkChild: node("sparkChild", "A.6.1.1.1.2", "Spark ICD", "Section"),
      groveRoot: node("groveRoot", "A.6.1.1.2", "Grove", "Core"),
      groveChild: node("groveChild", "A.6.1.1.2.5", "Grove ICD", "Section"),
    };
    docsImpl = () => Promise.resolve(agentDocs);
    graphImpl = () =>
      Promise.resolve({
        participants: [
          { id: "e-spark", slug: "spark", name: "Spark", et: "agent", st: "prime", did: "sparkRoot" },
          { id: "e-grove", slug: "grove", name: "Grove", et: "agent", st: "prime", did: "groveRoot" },
        ],
        instances: [],
        invocations: [],
        primitives: [],
        edges: [],
      });

    render(<ModFrequencyReport query="" mode="broad" />);
    // agentScope, sparkRoot, and groveRoot are self-excluded (an agent's own
    // root doc isn't "under" the agent) and stay in the plain A.6 bucket;
    // sparkChild/groveChild are the ones that resolve to an owning agent.
    expect(await screen.findByRole("heading", { name: /A\.6 — The Agent Scope \(3\)/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /A\.6 — Spark \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /A\.6 — Grove \(1\)/ })).toBeInTheDocument();
  });

  it("doesn't sub-split A.6 by agent in preview mode (graph describes the live atlas, not the preview)", async () => {
    const agentDocs: Record<string, AtlasNode> = {
      ...DOCS,
      agentScope: node("agentScope", "A.6", "The Agent Scope", "Scope"),
      sparkRoot: node("sparkRoot", "A.6.1.1.1", "Spark", "Core"),
      sparkChild: node("sparkChild", "A.6.1.1.1.2", "Spark ICD", "Section"),
    };
    docsImpl = () => Promise.resolve(agentDocs);
    graphImpl = () =>
      Promise.resolve({
        participants: [{ id: "e-spark", slug: "spark", name: "Spark", et: "agent", st: "prime", did: "sparkRoot" }],
        instances: [],
        invocations: [],
        primitives: [],
        edges: [],
      });

    const previewSource: DataSource = { base: "/api/preview/abc123/", preview: { id: "abc123", sha: "abc123" } };
    render(
      <DataSourceContext.Provider value={previewSource}>
        <ModFrequencyReport query="" mode="broad" />
      </DataSourceContext.Provider>,
    );
    expect(await screen.findByRole("heading", { name: /A\.6 — The Agent Scope \(3\)/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /A\.6 — Spark/ })).not.toBeInTheDocument();
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
