// @vitest-environment jsdom
// EntityFlow renders a force-directed graph of atlas entities via @xyflow/react.
// jsdom has no layout engine, so @xyflow/react is fully mocked: our ReactFlow
// stub iterates `nodes` and calls `nodeTypes[node.type]({ data, selected })`
// directly, which is what actually renders EntityCard/CardBody/RelationChip
// (the bulk of this file). graphology + the force-atlas2/noverlap layout passes
// are pure math and run for real against a tiny fixture graph.

import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { useState, createElement, type ComponentType } from "react";
import type { Node, NodeProps } from "@xyflow/react";

const mocks = vi.hoisted(() => ({
  getEdges: vi.fn(),
  track: vi.fn(),
}));

vi.mock("../../lib/graph", () => ({ getEdges: mocks.getEdges }));
vi.mock("../../lib/analytics", () => ({ track: mocks.track }));

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    nodes,
    nodeTypes,
    onNodeClick,
    children,
  }: {
    nodes: Node[];
    nodeTypes: Record<string, ComponentType<NodeProps>>;
    onNodeClick?: (e: unknown, node: Node) => void;
    children?: React.ReactNode;
  }) => (
    <div data-testid="reactflow">
      {nodes
        .filter((n) => !n.hidden)
        .map((n) =>
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
          createElement(
            "div",
            { key: n.id, "data-testid": `rf-node-${n.id}`, onClick: () => onNodeClick?.({}, n) },
            createElement(nodeTypes[n.type as string], { id: n.id, data: n.data, selected: !!n.selected } as NodeProps),
          ),
        )}
      {children}
    </div>
  ),
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
  Handle: () => <div data-testid="handle" />,
  Position: { Top: "top", Bottom: "bottom" },
  BackgroundVariant: { Dots: "dots" },
  MarkerType: { ArrowClosed: "arrowclosed" },
  useNodesState: (init: unknown) => {
    const [s, set] = useState(init);
    return [s, set, () => {}];
  },
  useEdgesState: (init: unknown) => {
    const [s, set] = useState(init);
    return [s, set, () => {}];
  },
}));

import { EntityFlow } from "./EntityFlow";
import type { EntityNodeData, EntityEdgeData } from "../../lib/entityGraph";
import type { GraphEntity, ResolvedEdge } from "@/types";
import type { EdgeResult } from "../../lib/graph";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function entity(over: Partial<GraphEntity> = {}): GraphEntity {
  return {
    id: "e-prime",
    slug: "prime",
    name: "Prime Agent",
    et: "agent",
    st: "prime",
    did: "doc-uuid-1",
    ...over,
  };
}

function nodeData(over: Partial<EntityNodeData> = {}): EntityNodeData {
  return {
    id: "e-prime",
    label: "Prime Agent",
    entity: entity(),
    color: "var(--entity-agent)",
    degree: 2,
    size: 14,
    ...over,
  };
}

const NODE_A = nodeData();
const NODE_B = nodeData({ id: "e-exec", label: "Executor Org", entity: entity({ id: "e-exec", slug: "exec", name: "Executor Org", et: "facilitator_org", st: "executor", did: null }), degree: 1, size: 10 });
const NODE_C = nodeData({ id: "e-third", label: "Third Party", entity: entity({ id: "e-third", slug: "third", name: "Third Party", et: "governance_body", st: null, did: null }), degree: 0, size: 4 });

const EDGE_AB: EntityEdgeData = { key: "e0", src: "e-prime", tgt: "e-exec", type: "prime_agent_for", sources: ["A.1"] };

function resolvedEdge(over: Partial<ResolvedEdge> = {}): ResolvedEdge {
  return { f: "e-prime", ft: "entity", t: "e-exec", tt: "entity", e: "prime_agent_for", s: ["A.1"], ...over };
}

function edgeResult(over: Partial<EdgeResult> = {}): EdgeResult {
  return { outbound: [], inbound: [], ...over };
}

function renderFlow(over: Partial<Parameters<typeof EntityFlow>[0]> = {}) {
  const onSelect = vi.fn();
  const utils = render(
    <EntityFlow
      allNodes={[NODE_A, NODE_B, NODE_C]}
      allEdges={[EDGE_AB]}
      visibleIds={new Set(["e-prime", "e-exec", "e-third"])}
      selectedId={null}
      onSelect={onSelect}
      {...over}
    />,
  );
  return { ...utils, onSelect };
}

describe("EntityFlow — node rendering", () => {
  it("renders a card for every visible node with its label and type", () => {
    renderFlow();
    expect(screen.getByText("Prime Agent")).toBeInTheDocument();
    expect(screen.getByText("Executor Org")).toBeInTheDocument();
    expect(screen.getByText("Third Party")).toBeInTheDocument();
    expect(screen.getByText("Agent · Prime")).toBeInTheDocument();
  });

  it("shows entity type without a subtype suffix when there is none", () => {
    renderFlow();
    expect(screen.getByText("Governance Body")).toBeInTheDocument();
  });

  it("hides nodes not in visibleIds", () => {
    renderFlow({ visibleIds: new Set(["e-prime"]) });
    expect(screen.getByText("Prime Agent")).toBeInTheDocument();
    expect(screen.queryByText("Executor Org")).not.toBeInTheDocument();
  });

  it("shows a connection count on an unselected card with degree > 0", () => {
    renderFlow();
    expect(screen.getByText("2 connections")).toBeInTheDocument();
    expect(screen.getByText("1 connection")).toBeInTheDocument();
  });

  it("shows no connection count for a degree-0 unselected card", () => {
    renderFlow();
    // Third Party has degree 0 — no "0 connections" text anywhere.
    expect(screen.queryByText(/0 connection/)).not.toBeInTheDocument();
  });

  it("clicking a node card fires onSelect and tracks the selection", () => {
    mocks.getEdges.mockReturnValue(new Promise(() => {}));
    const { onSelect } = renderFlow();
    fireEvent.click(screen.getByTestId("rf-node-e-exec"));
    expect(onSelect).toHaveBeenCalledWith("e-exec");
    expect(mocks.track).toHaveBeenCalledWith("constellation_select", { entity_id: "e-exec" });
  });
});

describe("EntityFlow — selected card body (relations)", () => {
  it("shows a loading placeholder while edges are pending", () => {
    mocks.getEdges.mockReturnValue(new Promise(() => {}));
    renderFlow({ selectedId: "e-prime" });
    expect(screen.getByText("…")).toBeInTheDocument();
  });

  it("shows 'No relations.' once edges resolve empty", async () => {
    mocks.getEdges.mockResolvedValue(edgeResult());
    renderFlow({ selectedId: "e-prime" });
    expect(await screen.findByText("No relations.")).toBeInTheDocument();
  });

  it("renders the defining-document link when entity.did is set", async () => {
    mocks.getEdges.mockResolvedValue(edgeResult());
    renderFlow({ selectedId: "e-prime" });
    const link = await screen.findByRole("link", { name: "→ defining document" });
    expect(link).toHaveAttribute("href", "/atlas?id=doc-uuid-1");
  });

  it("does not render the defining-document link when entity.did is null", async () => {
    mocks.getEdges.mockResolvedValue(edgeResult());
    renderFlow({ selectedId: "e-exec" });
    await screen.findByText("No relations.");
    expect(screen.queryByRole("link", { name: "→ defining document" })).not.toBeInTheDocument();
  });

  it("groups relations by edge type + direction, most numerous first, and renders doc/entity/other chips", async () => {
    mocks.getEdges.mockResolvedValue(
      edgeResult({
        outbound: [
          resolvedEdge({ t: "doc-target", tt: "doc", e: "cites", to_label: undefined }),
          resolvedEdge({ t: "e-exec", tt: "entity", e: "prime_agent_for", to_label: "Executor Org" }),
        ],
        inbound: [
          resolvedEdge({ f: "addr:1:0xabc0000000000000000000000000000000abcd", ft: "address", t: "e-prime", e: "has_address", from_label: undefined }),
        ],
      }),
    );
    renderFlow({ selectedId: "e-prime" });

    // outbound "cites" doc relation
    const docChipText = await screen.findByText("doc-target".slice(0, 8));
    expect(docChipText.closest("a")).toHaveAttribute("href", "/atlas?id=doc-target");

    // outbound entity relation (uses to_label directly)
    expect(screen.getByRole("button", { name: /Executor Org/ })).toBeInTheDocument();

    // inbound address relation renders as a plain (non-link, non-button) chip
    const addrChip = screen.getByText((t) => t.startsWith("1:0xabc00000"));
    expect(addrChip.tagName).toBe("SPAN");

    // group headers use edgeLabel()
    expect(screen.getByText(/cites · 1/)).toBeInTheDocument();
    expect(screen.getByText(/prime agent for · 1/)).toBeInTheDocument();
    expect(screen.getByText(/owned by · 1/)).toBeInTheDocument();
  });

  it("clicking an entity relation chip calls onSelect with the other entity's id", async () => {
    mocks.getEdges.mockResolvedValue(
      edgeResult({ outbound: [resolvedEdge({ t: "e-exec", tt: "entity", e: "prime_agent_for", to_label: "Executor Org" })] }),
    );
    const { onSelect } = renderFlow({ selectedId: "e-prime" });
    const chip = await screen.findByRole("button", { name: /Executor Org/ });
    fireEvent.click(chip);
    expect(onSelect).toHaveBeenCalledWith("e-exec");
  });

  it("renders parameters with their source-document links and truncates long values", async () => {
    const longValue = "x".repeat(120);
    mocks.getEdges.mockResolvedValue(edgeResult());
    renderFlow({
      selectedId: "e-prime",
      allNodes: [
        nodeData({
          entity: entity({
            m: JSON.stringify({
              params: {
                threshold: ["3", "src-doc-1", "A.1.1"],
                longParam: [longValue, "src-doc-2", "A.1.2"],
              },
            }),
          }),
        }),
        NODE_B,
        NODE_C,
      ],
    });
    expect(await screen.findByText("parameters · 2")).toBeInTheDocument();
    expect(screen.getByText("threshold")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(`${"x".repeat(90)}…`)).toBeInTheDocument();
  });

  it("warns (and keeps showing the loading placeholder) if the edges request fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.getEdges.mockRejectedValue(new Error("worker timeout"));
    renderFlow({ selectedId: "e-prime" });
    await waitFor(() => expect(warnSpy).toHaveBeenCalledWith("graph edges request failed", expect.any(Error)));
    expect(screen.getByText("…")).toBeInTheDocument();
  });

  it("re-fetches edges when the selected entity changes", async () => {
    mocks.getEdges.mockResolvedValue(edgeResult());
    const { rerender } = renderFlow({ selectedId: "e-prime" });
    await waitFor(() => expect(mocks.getEdges).toHaveBeenCalledWith("e-prime"));
    rerender(
      <EntityFlow
        allNodes={[NODE_A, NODE_B, NODE_C]}
        allEdges={[EDGE_AB]}
        visibleIds={new Set(["e-prime", "e-exec", "e-third"])}
        selectedId="e-exec"
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(mocks.getEdges).toHaveBeenCalledWith("e-exec"));
  });
});
