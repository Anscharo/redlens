// @vitest-environment jsdom
// NodeMeta renders the doc-type pill plus two copy-to-clipboard buttons (doc_no,
// permalink) and an external "open on Sky Atlas" link. Clipboard writes are
// stubbed since jsdom has no real clipboard; the "Copied!" flip state is driven
// by useCopyState (real, not mocked) so these also cover that hook's happy path.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { NodeMeta } from "./NodeMeta";
import { makeNode } from "../../test/fixtures";

afterEach(cleanup);

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

describe("NodeMeta", () => {
  it("renders the doc type pill and doc_no", () => {
    render(<NodeMeta node={makeNode({ type: "Core", doc_no: "A.1.2" })} />);
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("A.1.2")).toBeInTheDocument();
  });

  // These two use fireEvent, not userEvent: userEvent.setup() installs its own
  // clipboard stub on navigator, which would shadow our writeText spy.
  it("copies the doc_no and flips to a copied state on click", async () => {
    render(<NodeMeta node={makeNode({ doc_no: "A.9.9" })} />);
    const btn = screen.getByTitle("Copy A.9.9");
    fireEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith("A.9.9");
    await waitFor(() => expect(screen.getByTitle("Copied!")).toBeInTheDocument());
  });

  it("copies a permalink built from the current origin and router base", async () => {
    const node = makeNode({ id: "00000000-0000-4000-8000-000000000042" });
    render(
      <Router base="/preview/abc123">
        <NodeMeta node={node} />
      </Router>,
    );
    const btn = screen.getByTitle(`Copy link · ${node.id}`);
    fireEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/preview/abc123/atlas?id=${node.id}`,
    );
    await waitFor(() => expect(screen.getByTitle("Copied!")).toBeInTheDocument());
  });

  it("shows a truncated id label on the copy-link button", () => {
    const node = makeNode({ id: "00000000-0000-4000-8000-000000000042" });
    render(<NodeMeta node={node} />);
    expect(screen.getByText(`${node.id.slice(0, 3)}…${node.id.slice(-3)}`)).toBeInTheDocument();
  });

  it("links out to Sky Atlas with the node id anchor", () => {
    const node = makeNode({ id: "00000000-0000-4000-8000-000000000099" });
    render(<NodeMeta node={node} />);
    const link = screen.getByRole("link", { name: "Open on Sky Atlas" });
    expect(link).toHaveAttribute("href", `https://sky-atlas.io/#${node.id}`);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("stops propagation on copy-button clicks so the row isn't also selected", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <NodeMeta node={makeNode({ doc_no: "A.5.5" })} />
      </div>,
    );
    await user.click(screen.getByTitle("Copy A.5.5"));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("stops propagation on the external link click", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <NodeMeta node={makeNode()} />
      </div>,
    );
    await user.click(screen.getByRole("link", { name: "Open on Sky Atlas" }));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
