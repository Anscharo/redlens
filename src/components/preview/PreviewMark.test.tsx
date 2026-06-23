// @vitest-environment jsdom
// PreviewMark is the inline redline glyph: "+" for added docs, "Δ" for changed,
// nothing otherwise. The diff comes from usePreviewDiff (mocked here).

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
});
