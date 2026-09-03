// @vitest-environment jsdom
// RightPanel is a controlled three-tab panel (annotations / glossary / history).
// We assert the tablist wiring (aria-selected + onTabChange) and that each tab
// renders its own content. The history children fetch from the server, so they're
// stubbed — the live-vs-preview history split is an L3 concern.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { RightPanel } from "./RightPanel";
import { makeNode, makeEdgeResult, makeGlossaryEntry, makeAddressInfo, makeEdge } from "../../test/fixtures";
import { DataSourceContext } from "../../lib/dataSource";

vi.mock("../history/NodeHistory", () => ({
  NodeHistory: () => <div data-testid="node-history" />,
}));
vi.mock("../history/PreviewHistory", () => ({
  PreviewHistory: () => <div data-testid="preview-history" />,
}));

afterEach(cleanup);

type Tab = "notes" | "glossary" | "history";

function setup(overrides: Partial<Parameters<typeof RightPanel>[0]> = {}) {
  const onTabChange = vi.fn();
  const onNavigate = vi.fn();
  const onNavigateByDocNo = vi.fn();
  const props = {
    id: "node-1",
    linkedNodes: [],
    cousinDocs: [],
    targetAddresses: {},
    chainValues: {},
    annotationCount: 0,
    graphEdges: makeEdgeResult(),
    glossaryTerms: [],
    onNavigate,
    onNavigateByDocNo,
    tab: "notes" as Tab,
    onTabChange,
    ...overrides,
  };
  render(<RightPanel {...props} />);
  return { onTabChange, onNavigate, onNavigateByDocNo };
}

describe("RightPanel tablist", () => {
  it("marks the active tab via aria-selected", () => {
    setup({ tab: "glossary" });
    expect(screen.getByRole("tab", { name: /glossary/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /notes/ })).toHaveAttribute("aria-selected", "false");
  });

  it("calls onTabChange with the clicked tab", () => {
    const { onTabChange } = setup({ tab: "notes" });
    fireEvent.click(screen.getByRole("tab", { name: /glossary/ }));
    expect(onTabChange).toHaveBeenCalledWith("glossary");
    fireEvent.click(screen.getByRole("tab", { name: /history/ }));
    expect(onTabChange).toHaveBeenCalledWith("history");
  });

  it("shows the annotation count badge when there are linked docs", () => {
    setup({ linkedNodes: [makeNode(), makeNode()], annotationCount: 2 });
    expect(screen.getByText(/linked documents · 2/)).toBeInTheDocument();
  });

  it("labels equivalent cousin documents by agent", () => {
    setup({
      cousinDocs: [{ node: makeNode({ title: "Grove Agent Artifact" }), agent: "Grove" }],
      annotationCount: 1,
    });
    expect(screen.getByText(/cousin documents · 1/)).toBeInTheDocument();
    // Agent shown as the reader's agent pill (just the name), not "<name> agent".
    const pill = screen.getByText("Grove");
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveClass("atlas-agent-pill");
  });
});

describe("RightPanel tab content", () => {
  it("renders addresses on the notes tab", () => {
    setup({
      tab: "notes",
      targetAddresses: { "0xabc": makeAddressInfo({ label: "MCD_VAT" }) },
    });
    expect(screen.getByText(/addresses · 1/)).toBeInTheDocument();
  });

  it("shows the empty-state message on an empty glossary tab", () => {
    setup({ tab: "glossary", glossaryTerms: [] });
    expect(screen.getByText("No glossary terms in this section.")).toBeInTheDocument();
  });

  it("groups glossary terms on the glossary tab", () => {
    setup({ tab: "glossary", glossaryTerms: [[makeGlossaryEntry({ term: "Accord" })]] });
    expect(screen.getByRole("button", { name: "Accord" })).toBeInTheDocument();
  });

  it("renders live NodeHistory on the history tab when not in preview", () => {
    setup({ tab: "history" });
    expect(screen.getByTestId("node-history")).toBeInTheDocument();
  });

  it("renders PreviewHistory on the history tab when in preview mode", () => {
    const onTabChange = vi.fn();
    render(
      <DataSourceContext.Provider value={{ base: "/api/preview/abc/", preview: { id: "abc", sha: "abc123" } }}>
        <RightPanel
          id="node-1"
          linkedNodes={[]}
          cousinDocs={[]}
          targetAddresses={{}}
          chainValues={{}}
          annotationCount={0}
          graphEdges={makeEdgeResult()}
          glossaryTerms={[]}
          onNavigate={vi.fn()}
          onNavigateByDocNo={vi.fn()}
          tab="history"
          onTabChange={onTabChange}
        />
      </DataSourceContext.Provider>,
    );
    expect(screen.getByTestId("preview-history")).toBeInTheDocument();
    expect(screen.queryByTestId("node-history")).not.toBeInTheDocument();
  });

  it("renders a selection checkbox on related cards when selectable", () => {
    const byParent = new Map<string | null, ReturnType<typeof makeNode>[]>();
    setup({
      linkedNodes: [makeNode({ title: "Selectable Node" })],
      selectable: true,
      byParent,
    });
    expect(screen.getByLabelText("Select Selectable Node")).toBeInTheDocument();
  });

  it("does not render a selection checkbox when selectable is false", () => {
    setup({ linkedNodes: [makeNode({ title: "Plain Node" })], selectable: false });
    expect(screen.queryByLabelText("Select Plain Node")).not.toBeInTheDocument();
  });
});

describe("RightPanel glossary grouping", () => {
  it("shows source-context buttons and content for multi-entry groups, and navigates on click", async () => {
    const user = userEvent.setup();
    const nodeId = "term-node";
    const { onNavigate } = setup({
      tab: "glossary",
      glossaryTerms: [
        [
          makeGlossaryEntry({
            term: "Accord",
            nodeId,
            content: "First definition.",
            sourceContext: "Article A",
          }),
          makeGlossaryEntry({
            term: "Accord",
            nodeId: "term-node-2",
            content: "Second definition.",
            sourceContext: "Article B",
          }),
        ],
      ],
    });
    expect(screen.getByText("Article A")).toBeInTheDocument();
    expect(screen.getByText("Article B")).toBeInTheDocument();
    expect(screen.getByText("First definition.")).toBeInTheDocument();
    expect(screen.getByText("Second definition.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Accord" }));
    expect(onNavigate).toHaveBeenCalledWith(nodeId);

    await user.click(screen.getByText("Article B"));
    expect(onNavigate).toHaveBeenCalledWith("term-node-2");
  });

  it("omits the source-context button for a single-entry group", () => {
    setup({
      tab: "glossary",
      glossaryTerms: [[makeGlossaryEntry({ term: "Solo", sourceContext: "Should not show" })]],
    });
    expect(screen.queryByText("Should not show")).not.toBeInTheDocument();
  });
});

describe("RightPanel graph relations", () => {
  it("renders cited-by entries and navigates on click", async () => {
    const user = userEvent.setup();
    const { onNavigate } = setup({
      tab: "notes",
      graphEdges: makeEdgeResult({
        inbound: [makeEdge({ e: "cites", f: "citer-1", s: ["A.9.9"] })],
      }),
    });
    expect(screen.getByText(/cited by · 1/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "A.9.9" }));
    expect(onNavigate).toHaveBeenCalledWith("citer-1");
  });

  it("falls back to a truncated id when a cited-by edge has no source doc_no", async () => {
    setup({
      tab: "notes",
      graphEdges: makeEdgeResult({
        inbound: [makeEdge({ e: "cites", f: "12345678-abcd-ef00-1234-56789abcdef0", s: undefined })],
      }),
    });
    expect(screen.getByText("12345678")).toBeInTheDocument();
  });

  it("renders outbound relations with a navigable doc target and defined-in doc_no links", async () => {
    const user = userEvent.setup();
    const { onNavigate, onNavigateByDocNo } = setup({
      id: "self-id",
      tab: "notes",
      graphEdges: makeEdgeResult({
        outbound: [
          makeEdge({
            e: "depends_on",
            f: "self-id",
            t: "target-doc",
            tt: "doc",
            to_label: "Target Doc",
            s: ["A.2.2"],
          }),
        ],
      }),
    });
    expect(screen.getByText(/relations · 1/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Target Doc" }));
    expect(onNavigate).toHaveBeenCalledWith("target-doc");
    await user.click(screen.getByRole("button", { name: "A.2.2" }));
    expect(onNavigateByDocNo).toHaveBeenCalledWith("A.2.2");
  });

  it("renders inbound entity relations as non-navigable labels with the inbound arrow", () => {
    setup({
      tab: "notes",
      graphEdges: makeEdgeResult({
        inbound: [
          makeEdge({
            e: "responsible_for",
            f: "entity-1",
            ft: "entity",
            t: "node-1",
            from_label: "Grove Facilitator",
            from_did: undefined,
          }),
        ],
      }),
    });
    expect(screen.getByText(/relations · 1/)).toBeInTheDocument();
    expect(screen.getByText("Grove Facilitator")).toBeInTheDocument();
    expect(screen.getByText("←")).toBeInTheDocument();
  });

  it("hides relations pointing back at the current node (self-nav) from the rendered rows", () => {
    setup({
      id: "node-1",
      tab: "notes",
      graphEdges: makeEdgeResult({
        outbound: [makeEdge({ e: "depends_on", f: "node-1", t: "node-1", tt: "doc" })],
      }),
    });
    // The section header still counts the raw edge, but no row is rendered for it.
    expect(screen.getByText(/relations · 1/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /node-1|00000000/ })).not.toBeInTheDocument();
  });

  it("filters out HIDE-listed edge kinds from the relations section", () => {
    setup({
      tab: "notes",
      graphEdges: makeEdgeResult({
        outbound: [makeEdge({ e: "parent_of", f: "node-1", t: "child-1", tt: "doc" })],
      }),
    });
    expect(screen.queryByText(/relations ·/)).not.toBeInTheDocument();
  });
});
