// @vitest-environment jsdom
// AtlasView is the shell around AtlasReader + AtlasAnnotations: it owns the
// Loading / Not-found branches, breadcrumbs, and wiring annotation data down.
// AtlasReader and AtlasAnnotations are stubbed so we assert AtlasView's OWN
// logic — their internals are covered by their own test files.

import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AtlasView } from "./AtlasView";
import { makeNode, makeAtlasBundle, makeLoadedData } from "../../test/fixtures";

beforeAll(() => {
  // DrawerToggle (rendered for real, not stubbed) reads matchMedia.
  window.matchMedia =
    window.matchMedia ??
    ((): MediaQueryList =>
      ({
        matches: false,
        media: "",
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList);
  // Breadcrumbs (rendered for real) observes its own width via ResizeObserver.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
});

afterEach(cleanup);

const useAtlasDataMock = vi.fn();
const useLoadedMock = vi.fn();
const useAtlasSelectionMock = vi.fn();
const useNodeAnnotationsMock = vi.fn();
const useDocViewTrackingMock = vi.fn();
const useDocumentTitleMock = vi.fn();
const buildOwningAgentMapMock = vi.fn();
const useDataSourceMock = vi.fn();

vi.mock("../../hooks/useAtlasData", () => ({
  useAtlasData: (...args: unknown[]) => useAtlasDataMock(...args),
  useLoaded: (...args: unknown[]) => useLoadedMock(...args),
}));
vi.mock("../../hooks/useAtlasSelection", () => ({
  useAtlasSelection: (...args: unknown[]) => useAtlasSelectionMock(...args),
}));
vi.mock("../../hooks/useNodeAnnotations", () => ({
  useNodeAnnotations: (...args: unknown[]) => useNodeAnnotationsMock(...args),
}));
vi.mock("../../hooks/useDocViewTracking", () => ({
  useDocViewTracking: (...args: unknown[]) => useDocViewTrackingMock(...args),
}));
vi.mock("../../hooks/useDocumentTitle", () => ({
  useDocumentTitle: (...args: unknown[]) => useDocumentTitleMock(...args),
}));
vi.mock("../../lib/graph", () => ({
  loadGraph: vi.fn(),
}));
vi.mock("../../lib/owningAgent", () => ({
  buildOwningAgentMap: (...args: unknown[]) => buildOwningAgentMapMock(...args),
}));
vi.mock("../../lib/dataSource", () => ({
  useDataSource: (...args: unknown[]) => useDataSourceMock(...args),
}));
vi.mock("./AtlasReader", () => ({
  AtlasReader: (props: { id: string; splitId: string | null }) => (
    <div data-testid="atlas-reader" data-id={props.id} data-split={props.splitId ?? ""} />
  ),
}));
vi.mock("./AtlasAnnotations", () => ({
  AtlasAnnotations: (props: {
    annotationCount: number;
    tab: string;
    onNavigateByDocNo: (docNo: string) => void;
  }) => (
    <div data-testid="atlas-annotations" data-count={props.annotationCount} data-tab={props.tab}>
      <button onClick={() => props.onNavigateByDocNo("A.1")}>navigate-by-doc-no</button>
    </div>
  ),
}));

const EMPTY_ANNOTATIONS = {
  linkedNodes: [],
  targetAddresses: {},
  chainValues: {},
  glossaryTerms: [],
  cousinDocs: [],
};

function setupMocks({
  data,
  preview = null,
  selectedId = "node-1",
  annotations = EMPTY_ANNOTATIONS,
}: {
  data: ReturnType<typeof makeLoadedData> | null;
  preview?: { id: string; sha: string } | null;
  selectedId?: string | null;
  annotations?: typeof EMPTY_ANNOTATIONS;
}) {
  useAtlasDataMock.mockReturnValue(data);
  useLoadedMock.mockReturnValue(null);
  useDataSourceMock.mockReturnValue({ base: "", preview });
  useAtlasSelectionMock.mockReturnValue({ selectedId, handleNavigate: vi.fn() });
  useNodeAnnotationsMock.mockReturnValue(annotations);
  buildOwningAgentMapMock.mockReturnValue(new Map());
}

function baseProps(overrides: Partial<Parameters<typeof AtlasView>[0]> = {}) {
  return {
    id: "node-1",
    onNavigate: vi.fn(),
    view: "annotations" as const,
    onViewChange: vi.fn(),
    splitId: null,
    onSplitChange: vi.fn(),
    ...overrides,
  };
}

describe("AtlasView loading / not-found branches", () => {
  it("renders Loading when data is null", () => {
    setupMocks({ data: null });
    render(<AtlasView {...baseProps()} />);
    expect(screen.getByText("searching the stars")).toBeInTheDocument();
    expect(screen.queryByTestId("atlas-reader")).toBeNull();
  });

  it("renders Loading (not not-found) when id is missing but data isn't complete", () => {
    const data = makeLoadedData({ complete: false });
    setupMocks({ data });
    render(<AtlasView {...baseProps({ id: "missing-id" })} />);
    expect(screen.getByText("searching the stars")).toBeInTheDocument();
    expect(screen.queryByText(/Node not found/)).toBeNull();
  });

  it("renders 'Node not found' when id is missing and data is complete", () => {
    const data = makeLoadedData({ complete: true });
    setupMocks({ data });
    render(<AtlasView {...baseProps({ id: "missing-id" })} />);
    expect(screen.getByText("Node not found: missing-id")).toBeInTheDocument();
  });
});

describe("AtlasView normal render", () => {
  it("renders breadcrumbs, reader, and annotations for a valid id", () => {
    const node = makeNode({ id: "node-1", doc_no: "A.1", title: "Root Node" });
    const atlas = makeAtlasBundle([node]);
    const data = makeLoadedData({ atlas, complete: true });
    setupMocks({ data });
    render(<AtlasView {...baseProps()} />);
    expect(screen.getByRole("navigation", { name: "Breadcrumbs" })).toBeInTheDocument();
    const reader = screen.getByTestId("atlas-reader");
    expect(reader).toHaveAttribute("data-id", "node-1");
    expect(screen.getByTestId("atlas-annotations")).toBeInTheDocument();
  });

  it("computes annotationCount from linkedNodes + cousinDocs + addresses", () => {
    const node = makeNode({ id: "node-1", doc_no: "A.1" });
    const atlas = makeAtlasBundle([node]);
    const data = makeLoadedData({ atlas, complete: true });
    setupMocks({
      data,
      annotations: {
        linkedNodes: [makeNode(), makeNode()] as never[],
        targetAddresses: { "0xabc": {} as never },
        chainValues: {},
        glossaryTerms: [],
        cousinDocs: [{ node: makeNode(), agent: "Grove" } as never],
      },
    });
    render(<AtlasView {...baseProps()} />);
    // 2 linked + 1 cousin + 1 address = 4
    expect(screen.getByTestId("atlas-annotations")).toHaveAttribute("data-count", "4");
  });

  it("does not render breadcrumbs or annotations when id is empty", () => {
    const data = makeLoadedData({ complete: true });
    setupMocks({ data, selectedId: null });
    render(<AtlasView {...baseProps({ id: "" })} />);
    expect(screen.queryByRole("navigation", { name: "Breadcrumbs" })).toBeNull();
    expect(screen.queryByTestId("atlas-annotations")).toBeNull();
    // Reader is still rendered even with an empty id (it handles its own default view).
    expect(screen.getByTestId("atlas-reader")).toBeInTheDocument();
  });

  it("passes splitId through to AtlasReader", () => {
    const node = makeNode({ id: "node-1", doc_no: "A.1" });
    const atlas = makeAtlasBundle([node]);
    const data = makeLoadedData({ atlas, complete: true });
    setupMocks({ data });
    render(<AtlasView {...baseProps({ splitId: "node-2" })} />);
    expect(screen.getByTestId("atlas-reader")).toHaveAttribute("data-split", "node-2");
  });

  it("resolves onNavigateByDocNo through docNoToId and calls onNavigate with the uuid", () => {
    const node = makeNode({ id: "node-1", doc_no: "A.1" });
    const atlas = makeAtlasBundle([node]);
    const data = makeLoadedData({ atlas, complete: true });
    setupMocks({ data });
    const onNavigate = vi.fn();
    render(<AtlasView {...baseProps({ onNavigate })} />);
    fireEvent.click(screen.getByText("navigate-by-doc-no"));
    expect(onNavigate).toHaveBeenCalledWith("node-1");
  });

  it("does nothing when onNavigateByDocNo is given an unknown doc_no", () => {
    const node = makeNode({ id: "node-1", doc_no: "Z.9" });
    const atlas = makeAtlasBundle([node]);
    const data = makeLoadedData({ atlas, complete: true });
    setupMocks({ data });
    const onNavigate = vi.fn();
    render(<AtlasView {...baseProps({ onNavigate })} />);
    fireEvent.click(screen.getByText("navigate-by-doc-no"));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("passes null graph to useNodeAnnotations in preview mode (hides cousins)", () => {
    const node = makeNode({ id: "node-1", doc_no: "A.1" });
    const atlas = makeAtlasBundle([node]);
    const data = makeLoadedData({ atlas, complete: true });
    setupMocks({ data, preview: { id: "pr-1", sha: "abc" } });
    render(<AtlasView {...baseProps()} />);
    // 4th positional arg to useNodeAnnotations(id, data, graph) — graph must be null in preview.
    const lastCall = useNodeAnnotationsMock.mock.calls.at(-1)!;
    expect(lastCall[2]).toBeNull();
  });
});
