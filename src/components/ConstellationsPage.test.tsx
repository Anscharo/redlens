// @vitest-environment jsdom
// ConstellationsPage wires together the atlas doc index, a graph-worker hook,
// and the (xyflow-based) EntityFlow canvas. All three are heavy/async, so they're
// mocked here — this test exercises the page's own filtering/selection logic
// (visibleIds, type pills, focus) rather than xyflow rendering or worker plumbing.
import { it, expect, describe, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { GraphEntity, RelationEdge } from "@/types";

vi.mock("@/lib/docs", () => ({ loadAtlas: vi.fn() }));
vi.mock("../hooks/useConstellationsWorker", () => ({ useConstellationsWorker: vi.fn() }));
vi.mock("./constellations/EntityFlow", () => ({
  EntityFlow: (props: {
    allNodes: { id: string }[];
    visibleIds: Set<string>;
    selectedId: string | null;
  }) => (
    <div data-testid="entity-flow">
      visible {props.visibleIds.size} of {props.allNodes.length} · selected {props.selectedId ?? "none"}
    </div>
  ),
}));

import { loadAtlas } from "@/lib/docs";
import { useConstellationsWorker } from "../hooks/useConstellationsWorker";
import { ConstellationsPage } from "./ConstellationsPage";

function wrap(path = "/constellations") {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

const agent1: GraphEntity = { id: "agent1", slug: "agent-one", name: "Agent One", et: "agent", st: "prime", did: null };
const agent2: GraphEntity = { id: "agent2", slug: "agent-two", name: "Agent Two", et: "agent", st: "prime", did: null };
const facilitator: GraphEntity = {
  id: "fac1",
  slug: "fac-one",
  name: "Fac One",
  et: "facilitator_org",
  st: null,
  did: null,
};
const instance1: GraphEntity = {
  id: "inst1",
  slug: "inst-one",
  name: "Instance One",
  et: "instance",
  st: "reward-primitive",
  did: null,
};
const invocation1: GraphEntity = {
  id: "inv1",
  slug: "inv-one",
  name: "Invocation One",
  et: "invocation",
  st: null,
  did: null,
};
const primitive1: GraphEntity = {
  id: "prim1",
  slug: "prim-one",
  name: "Primitive One",
  et: "primitive",
  st: null,
  did: null,
};

const entities = [agent1, agent2, facilitator, instance1, invocation1, primitive1];
const entityEdges: RelationEdge[] = [
  { f: "agent1", ft: "entity", t: "fac1", tt: "entity", e: "prime_agent_for" },
];

function mockLoaded() {
  vi.mocked(loadAtlas).mockResolvedValue({
    docNoToId: new Map([["A.1", "agent1"]]),
  } as never);
  vi.mocked(useConstellationsWorker).mockReturnValue({
    init: { entities, entityEdges },
    initError: null,
    neighborIds: null,
    topId: null,
    clusterIds: null,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ConstellationsPage", () => {
  it("shows a loading state before the atlas + graph worker are ready", () => {
    vi.mocked(loadAtlas).mockReturnValue(new Promise(() => {}));
    vi.mocked(useConstellationsWorker).mockReturnValue({
      init: null,
      initError: null,
      neighborIds: null,
      topId: null,
      clusterIds: null,
    } as never);

    render(<ConstellationsPage query="" />, { wrapper: wrap() });
    expect(screen.getByText("loading constellations")).toBeInTheDocument();
  });

  it("sets the document title and renders once data resolves, hiding facilitator_org by default", async () => {
    mockLoaded();
    render(<ConstellationsPage query="" />, { wrapper: wrap() });

    await waitFor(() => expect(document.title).toBe("Constellations: Sky Atlas by Redline"));
    // Participants + instances = agent1, agent2, fac1, inst1 → 4 total nodes,
    // but facilitator_org is in DEFAULT_HIDDEN_TYPES, so only 3 are visible.
    expect(screen.getByTestId("entity-flow")).toHaveTextContent("visible 3 of 4");
    expect(screen.getByText(/6 total · 3 shown · 0 relationships/)).toBeInTheDocument();
  });

  it("toggles the filter panel open/closed", async () => {
    mockLoaded();
    render(<ConstellationsPage query="" />, { wrapper: wrap() });
    await screen.findByTestId("entity-flow");

    expect(screen.getByText("all")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Toggle the filters"));
    expect(screen.queryByText("all")).toBeNull();
    fireEvent.click(screen.getByLabelText("Toggle the filters"));
    expect(screen.getByText("all")).toBeInTheDocument();
  });

  it("hides all types via 'none' and restores via 'all'", async () => {
    mockLoaded();
    render(<ConstellationsPage query="" />, { wrapper: wrap() });
    await screen.findByTestId("entity-flow");

    fireEvent.click(screen.getByText("none"));
    expect(screen.getByTestId("entity-flow")).toHaveTextContent("visible 0 of 4");

    fireEvent.click(screen.getByText("all"));
    expect(screen.getByTestId("entity-flow")).toHaveTextContent("visible 4 of 4");
  });

  it("toggles a single type pill's visibility", async () => {
    mockLoaded();
    render(<ConstellationsPage query="" />, { wrapper: wrap() });
    await screen.findByTestId("entity-flow");

    const agentPill = screen.getByRole("button", { name: /Agent · 2/ });
    fireEvent.click(agentPill); // hide agents: 3 visible - 2 agents = 1
    expect(screen.getByTestId("entity-flow")).toHaveTextContent("visible 1 of 4");

    fireEvent.click(agentPill); // show again
    expect(screen.getByTestId("entity-flow")).toHaveTextContent("visible 3 of 4");
  });

  it("shows Focus buttons for prime agents and lets one be selected/cleared", async () => {
    mockLoaded();
    render(<ConstellationsPage query="" />, { wrapper: wrap() });
    await screen.findByTestId("entity-flow");

    const focusRow = screen.getByText("Focus:").parentElement!;
    expect(within(focusRow).getByText("Agent One")).toBeInTheDocument();
    expect(within(focusRow).getByText("Agent Two")).toBeInTheDocument();

    fireEvent.click(within(focusRow).getByText("Agent One"));
    // Clicking again clears the focus back to "All".
    fireEvent.click(within(focusRow).getByText("Agent One"));
    expect(within(focusRow).getByText("All")).toBeInTheDocument();
  });

  it("shows a query-scoped 'no results' message when neighborIds filters everything out", async () => {
    vi.mocked(loadAtlas).mockResolvedValue({ docNoToId: new Map() } as never);
    vi.mocked(useConstellationsWorker).mockReturnValue({
      init: { entities, entityEdges },
      initError: null,
      neighborIds: new Set<string>(),
      topId: null,
      clusterIds: null,
    } as never);

    render(<ConstellationsPage query="nonexistent" />, { wrapper: wrap() });
    await waitFor(() => expect(screen.getByText('no results for "nonexistent"')).toBeInTheDocument());
  });

  it("propagates a graph worker init failure to the nearest error boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(loadAtlas).mockResolvedValue({ docNoToId: new Map() } as never);
    vi.mocked(useConstellationsWorker).mockReturnValue({
      init: null,
      initError: new Error("worker init failed"),
      neighborIds: null,
      topId: null,
      clusterIds: null,
    } as never);

    const { ErrorBoundary } = await import("./ErrorBoundary");
    render(
      <ErrorBoundary fallback={(error) => <p>caught: {error.message}</p>}>
        <ConstellationsPage query="" />
      </ErrorBoundary>,
      { wrapper: wrap() },
    );

    await waitFor(() => expect(screen.getByText("caught: worker init failed")).toBeInTheDocument());
  });
});
