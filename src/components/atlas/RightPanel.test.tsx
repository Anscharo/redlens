// @vitest-environment jsdom
// RightPanel is a controlled three-tab panel (annotations / glossary / history).
// We assert the tablist wiring (aria-selected + onTabChange) and that each tab
// renders its own content. The history children fetch from the server, so they're
// stubbed — the live-vs-preview history split is an L3 concern.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RightPanel } from "./RightPanel";
import { makeNode, makeEdgeResult, makeGlossaryEntry, makeAddressInfo } from "../../test/fixtures";

vi.mock("../history/NodeHistory", () => ({
  NodeHistory: () => <div data-testid="node-history" />,
}));
vi.mock("../history/PreviewHistory", () => ({
  PreviewHistory: () => <div data-testid="preview-history" />,
}));

afterEach(cleanup);

type Tab = "annotations" | "glossary" | "history";

function setup(overrides: Partial<Parameters<typeof RightPanel>[0]> = {}) {
  const onTabChange = vi.fn();
  const onNavigate = vi.fn();
  const onNavigateByDocNo = vi.fn();
  const props = {
    id: "node-1",
    linkedNodes: [],
    targetAddresses: {},
    chainValues: {},
    annotationCount: 0,
    graphEdges: makeEdgeResult(),
    glossaryTerms: [],
    onNavigate,
    onNavigateByDocNo,
    tab: "annotations" as Tab,
    onTabChange,
    ...overrides,
  };
  render(<RightPanel {...props} />);
  return { onTabChange, onNavigate };
}

describe("RightPanel tablist", () => {
  it("marks the active tab via aria-selected", () => {
    setup({ tab: "glossary" });
    expect(screen.getByRole("tab", { name: /glossary/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /annotations/ })).toHaveAttribute("aria-selected", "false");
  });

  it("calls onTabChange with the clicked tab", () => {
    const { onTabChange } = setup({ tab: "annotations" });
    fireEvent.click(screen.getByRole("tab", { name: /glossary/ }));
    expect(onTabChange).toHaveBeenCalledWith("glossary");
    fireEvent.click(screen.getByRole("tab", { name: /history/ }));
    expect(onTabChange).toHaveBeenCalledWith("history");
  });

  it("shows the annotation count badge when there are linked docs", () => {
    setup({ linkedNodes: [makeNode(), makeNode()], annotationCount: 2 });
    expect(screen.getByText(/2 linked documents/)).toBeInTheDocument();
  });
});

describe("RightPanel tab content", () => {
  it("renders addresses on the annotations tab", () => {
    setup({
      tab: "annotations",
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
});
