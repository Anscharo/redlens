// @vitest-environment jsdom
// Annotations hang directly off the doc they annotate, but their `.0.3.N`
// numbering — and the reader's doc-number-length indentation — put them three
// columns further in, so they read as children of that doc's children. Three
// corrections, all asserted here: the "Annotates <target>" label, the smaller
// trailing chiclets, and the dropped chevron column.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { CollapsibleNode } from "./CollapsibleNode";
import { AtlasActionsContext } from "./AtlasActionsContext";
import { makeNode, makeFlatEntry } from "../../test/fixtures";
import type { AtlasNode } from "@/types";

afterEach(cleanup);

function setup(
  over: Partial<AtlasNode>,
  props: { isExpanded?: boolean; agentName?: string; docNoToId?: Map<string, string> } = {},
) {
  const node = makeNode({ id: "uuid-ann", ...over });
  return render(
    <AtlasActionsContext.Provider
      value={{
        navigate: () => {},
        toggle: () => {},
        splitNavigate: () => {},
        docNoToId: props.docNoToId,
      }}
    >
      <CollapsibleNode
        entry={makeFlatEntry({ node })}
        isSelected={false}
        isExpanded={props.isExpanded ?? false}
        hasChildren={false}
        agentName={props.agentName}
      />
    </AtlasActionsContext.Provider>,
  );
}

const ANNOTATION = { doc_no: "A.2.8.0.3.2", type: "Annotation", title: "Ecosystem - Element Annotation" };

describe("CollapsibleNode annotation rows", () => {
  it("names the annotated doc under the doc number", () => {
    const { container } = setup(ANNOTATION);
    expect(container.querySelector(".atlas-annotates")?.textContent).toBe("Annotates A.2.8");
  });

  // parentId would give the wrong answer for the 8 annotations whose target sits
  // below the parser's depth-6 heading cap; the doc_no suffix is exact.
  it("derives the target from the doc_no, not the parent link", () => {
    const { container } = setup({
      ...ANNOTATION,
      doc_no: "A.3.3.2.7.1.1.1.3.0.3.1",
      parentId: "some-shallower-ancestor",
    });
    expect(container.querySelector(".atlas-annotates")?.textContent).toBe("Annotates A.3.3.2.7.1.1.1.3");
  });

  it("steps down exactly the three bookkeeping segments", () => {
    const { container } = setup(ANNOTATION);
    const minor = [...container.querySelectorAll(".atlas-chiclet-minor")].map((c) => c.textContent);
    expect(minor).toEqual(["0", "3", "2"]);
  });

  it("renders no reserved chevron column", () => {
    const { container } = setup(ANNOTATION);
    expect(container.querySelector(".atlas-node-toggle")).toBeNull();
  });

  it("keeps the label visible when the row is expanded, above the agent pill", () => {
    const { container } = setup(ANNOTATION, { isExpanded: true, agentName: "Spark" });
    expect(container.querySelector(".atlas-annotates")).not.toBeNull();
    expect(container.querySelector(".atlas-agent-pill")?.textContent).toBe("Spark");
  });

  // The target can be hundreds of rows away (the atlas emits the supporting `0`
  // directory after every real sibling), so the label is the way back to it.
  it("links the label to the annotated doc when the target resolves", () => {
    const { container } = setup(ANNOTATION, {
      docNoToId: new Map([["A.2.8", "uuid-target"]]),
    });
    const link = container.querySelector("a.atlas-annotates")!;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("/atlas?id=uuid-target");
    expect(link.textContent).toBe("Annotates A.2.8");
  });

  // An un-merged deep tier (or a provider without the map) must not produce a
  // dead link.
  it("falls back to plain text when the target doc_no resolves to nothing", () => {
    const { container } = setup(ANNOTATION, { docNoToId: new Map() });
    expect(container.querySelector("a.atlas-annotates")).toBeNull();
    expect(container.querySelector("span.atlas-annotates")?.textContent).toBe("Annotates A.2.8");
  });

  it("leaves ordinary docs unchanged — chevron column, no label, no minor segments", () => {
    const { container } = setup({ doc_no: "A.2.8", type: "Article" });
    expect(container.querySelector(".atlas-node-toggle")).not.toBeNull();
    expect(container.querySelector(".atlas-annotates")).toBeNull();
    expect(container.querySelectorAll(".atlas-chiclet-minor")).toHaveLength(0);
  });
});
