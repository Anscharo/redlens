// @vitest-environment jsdom
// PreviewMark is the inline redline glyph: "+" for added docs, "Δ" for changed,
// nothing otherwise. The diff comes from usePreviewDiff (mocked here).

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("../../lib/previewDiff", () => ({ usePreviewDiff: vi.fn() }));

import { PreviewMark } from "./PreviewMark";
import { usePreviewDiff } from "../../lib/previewDiff";
import type { PreviewDiff } from "../../lib/previewDiff";

const mockDiff = vi.mocked(usePreviewDiff);

function setDiff(over: Partial<PreviewDiff>) {
  mockDiff.mockReturnValue({
    added: new Set(),
    changed: new Set(),
    renumbered: {},
    reusedSlot: {},
    identitySwap: {},
    formerUuid: {},
    ...over,
  });
}

afterEach(cleanup);

describe("PreviewMark", () => {
  it("renders + for an added doc", () => {
    setDiff({ added: new Set(["x"]) });
    render(<PreviewMark nodeId="x" />);
    const mark = screen.getByLabelText("new in this preview");
    expect(mark).toHaveTextContent("+");
  });

  it("renders Δ for a changed doc", () => {
    setDiff({ changed: new Set(["x"]) });
    render(<PreviewMark nodeId="x" />);
    expect(screen.getByLabelText("changed in this preview")).toHaveTextContent("Δ");
  });

  it("renders nothing for an untouched doc", () => {
    setDiff({ added: new Set(["other"]) });
    const { container } = render(<PreviewMark nodeId="x" />);
    expect(container.firstChild).toBeNull();
  });

  it("prefers the added marker when a doc is in both sets", () => {
    setDiff({ added: new Set(["x"]), changed: new Set(["x"]) });
    render(<PreviewMark nodeId="x" />);
    expect(screen.getByLabelText("new in this preview")).toHaveTextContent("+");
    expect(screen.queryByLabelText("changed in this preview")).toBeNull();
  });

  it("renders ⚠ for a repurposed UUID, overriding the Δ", () => {
    setDiff({
      changed: new Set(["x"]),
      identitySwap: { x: { oldTitle: "Operational GovOps", newTitle: "Sky Primitives", movedTo: { id: "y", doc_no: "A.6.1.2.2.2.1", title: "Soter Labs -" } } },
    });
    render(<PreviewMark nodeId="x" />);
    const mark = screen.getByLabelText("identity reassigned in this preview");
    expect(mark).toHaveTextContent("⚠");
    // The rich content now lives in the custom Tooltip (not a native title attr).
    expect(mark).not.toHaveAttribute("title");
    expect(screen.queryByLabelText("changed in this preview")).toBeNull();
  });

  it("renders ⚠ for a doc whose content came from a former UUID, overriding the +", () => {
    setDiff({
      added: new Set(["y"]),
      formerUuid: { y: { previousId: "x", previousTitle: "Operational GovOps", previousDocNo: "A.6.1.2.2.2" } },
    });
    render(<PreviewMark nodeId="y" />);
    const mark = screen.getByLabelText("identity reassigned in this preview");
    expect(mark).toHaveTextContent("⚠");
    expect(mark).not.toHaveAttribute("title");
    expect(screen.queryByLabelText("new in this preview")).toBeNull();
  });

  it("hovering the ⚠ shows a Tooltip linking to the relocated doc", () => {
    vi.useFakeTimers();
    try {
      setDiff({
        changed: new Set(["x"]),
        identitySwap: { x: { oldTitle: "Operational GovOps", newTitle: "Sky Primitives", movedTo: { id: "384d29b0-aaaa-bbbb-cccc-ddddeeeeffff", doc_no: "A.6.1.2.2.2.1", title: "Soter Labs -" } } },
      });
      render(<PreviewMark nodeId="x" />);
      const mark = screen.getByLabelText("identity reassigned in this preview");
      fireEvent.mouseEnter(mark);
      act(() => {
        vi.advanceTimersByTime(400); // past the 300ms tooltip delay
      });
      const tip = screen.getByRole("tooltip");
      expect(tip).toHaveTextContent("now holds a different document");
      const link = screen.getByRole("link", { name: /Soter Labs/ });
      expect(link).toHaveAttribute("href", expect.stringContaining("384d29b0-aaaa-bbbb-cccc-ddddeeeeffff"));
    } finally {
      vi.useRealTimers();
    }
  });
});
