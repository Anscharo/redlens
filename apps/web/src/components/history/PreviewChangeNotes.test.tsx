// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("../../lib/previewDiff", () => ({ usePreviewDiff: vi.fn() }));

import { PreviewChangeNotes } from "./PreviewChangeNotes";
import { usePreviewDiff, type PreviewDiff } from "../../lib/previewDiff";
import type { PreviewMeta } from "../../lib/previewMetaCopy";

afterEach(() => cleanup());

const REPO_META = { bases: { auto: "repo", repo: { repo: "acme/fork", ref: "main" } } } as PreviewMeta;

/** The notes for doc n1, with `over` as its slice of the preview diff. */
function notes(props: { hasPatch: boolean; status: "Added" | "Changed"; meta?: PreviewMeta }, over: Partial<PreviewDiff> = {}) {
  vi.mocked(usePreviewDiff).mockReturnValue({
    added: new Set(), changed: new Set(), renumbered: {}, retitled: {}, reusedSlot: {}, identitySwap: {}, formerUuid: {}, activeBase: null,
    ...over,
  });
  return render(<PreviewChangeNotes nodeId="n1" meta={props.meta ?? null} source="pull request" hasPatch={props.hasPatch} status={props.status} />);
}

describe("PreviewChangeNotes", () => {
  it("shows the neutral fallback sentence with the given label for a silent Changed doc", () => {
    notes({ hasPatch: false, status: "Changed" });
    expect(screen.getByText("No visible difference from the live atlas.")).toBeInTheDocument();
  });

  it("names a repo base in the fallback sentence", () => {
    notes({ hasPatch: false, status: "Changed", meta: REPO_META }, { activeBase: { key: "repo", auto: true } });
    expect(screen.getByText("No visible difference from acme/fork:main.")).toBeInTheDocument();
  });

  it("omits the fallback sentence once a patch is present, regardless of label", () => {
    notes({ hasPatch: true, status: "Changed", meta: REPO_META }, { activeBase: { key: "repo", auto: true } });
    expect(screen.queryByText(/No visible difference/)).not.toBeInTheDocument();
  });

  // The same rule as PreviewMark: ⚠ only where the displaced content was found.
  it("describes a swap with no relocation as rewritten, with no warning", () => {
    const swap = { oldTitle: "Operational GovOps", newTitle: "Sky Primitives" };
    const { container } = notes({ hasPatch: true, status: "Changed" }, { identitySwap: { n1: swap } });
    expect(container).toHaveTextContent("both the title and the body were replaced");
    expect(container).not.toHaveTextContent("Identity changed");
    expect(container).not.toHaveTextContent("⚠");
  });

  it("warns that the identity changed when the previous content was found elsewhere", () => {
    const swap = { oldTitle: "Operational GovOps", newTitle: "Sky Primitives", movedTo: { id: "y", doc_no: "A.6.1.2.2.2.1", title: "Soter Labs" } };
    const { container } = notes({ hasPatch: true, status: "Changed" }, { identitySwap: { n1: swap } });
    expect(container).toHaveTextContent("⚠ Identity changed");
    expect(container).toHaveTextContent("moved to A.6.1.2.2.2.1");
  });

  it("omits the fallback sentence for an Added doc (silent only applies to Changed)", () => {
    notes({ hasPatch: false, status: "Added" });
    expect(screen.queryByText(/No visible difference/)).not.toBeInTheDocument();
  });
});
