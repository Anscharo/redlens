// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { RelatedNode } from "./RelatedNode";
import { makeNode } from "../test/fixtures";

afterEach(cleanup);

const node = makeNode({ id: "rel-1", title: "Related Doc" });

describe("RelatedNode selection checkbox", () => {
  it("renders no checkbox without an onSelect handler", () => {
    const { container } = render(<RelatedNode node={node} onNavigate={vi.fn()} />);
    expect(container.querySelector(".atlas-node-select input")).toBeNull();
  });

  it("plain click toggles just this doc (shiftKey false)", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <RelatedNode node={node} onNavigate={vi.fn()} onSelect={onSelect} />,
    );
    fireEvent.click(container.querySelector(".atlas-node-select input")!);
    expect(onSelect).toHaveBeenCalledWith(node.id, false);
  });

  it("shift-click requests the subtree (shiftKey true)", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <RelatedNode node={node} onNavigate={vi.fn()} onSelect={onSelect} />,
    );
    fireEvent.click(container.querySelector(".atlas-node-select input")!, { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(node.id, true);
  });

  it("reflects the selected prop as the checkbox state", () => {
    const { container } = render(
      <RelatedNode node={node} onNavigate={vi.fn()} onSelect={vi.fn()} selected />,
    );
    expect(container.querySelector<HTMLInputElement>(".atlas-node-select input")!.checked).toBe(true);
  });
});
