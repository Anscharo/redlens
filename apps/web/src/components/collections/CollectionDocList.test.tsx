// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { AtlasNode } from "@/types";
import { CollectionDocList } from "./CollectionDocList";

afterEach(cleanup);

const node = (id: string, doc_no: string, title: string) => ({ id, doc_no, title }) as AtlasNode;
const docs: Record<string, AtlasNode> = {
  a: node("a", "A.1", "Alpha"),
  b: node("b", "A.2", "Beta"),
  c: node("c", "A.3", "Gamma"),
};

describe("CollectionDocList", () => {
  it("renders nothing until docs have loaded", () => {
    const { container } = render(<CollectionDocList ids={["a"]} docs={null} limit={10} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists doc_no and title, and skips ids the bundle does not know", () => {
    render(<CollectionDocList ids={["a", "ghost", "b"]} docs={docs} limit={10} />);
    expect(screen.getByText("A.1")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("ghost")).toBeNull();
  });

  it("cuts to the limit and counts the rest", () => {
    render(<CollectionDocList ids={["a", "b", "c"]} docs={docs} limit={2} />);
    expect(screen.queryByText("Gamma")).toBeNull();
    expect(screen.getByText("+1 more")).toBeInTheDocument();
  });

  it("marks added and removed rows with +/− and leaves unchanged rows unmarked", () => {
    render(
      <CollectionDocList
        ids={["a", "b", "c"]}
        docs={docs}
        limit={10}
        marks={new Map([["a", "remove"], ["b", "add"], ["c", "same"]] as const)}
      />,
    );
    expect(screen.getByLabelText("removed")).toHaveTextContent("−");
    expect(screen.getByLabelText("added")).toHaveTextContent("+");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    // The audited diff tokens, not literal colours.
    expect(screen.getByText("Alpha").closest("li")).toHaveStyle({ background: "var(--diff-removed-bg)" });
    expect(screen.getByText("Beta").closest("li")).toHaveStyle({ background: "var(--diff-added-bg)" });
  });
});
