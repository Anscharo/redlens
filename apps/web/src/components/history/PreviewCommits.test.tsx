// @vitest-environment jsdom
// PreviewCommits: the `?history=by-commit` switch under a preview's overall
// diff, and the diff base it walks the branch against.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("../../lib/previewDiff", () => ({ usePreviewDiff: vi.fn() }));
vi.mock("../../lib/previewMeta", () => ({ usePreviewMeta: () => ({ repo: "o/r" }) }));
vi.mock("../../hooks/usePreviewCommits", () => ({ usePreviewCommits: vi.fn() }));

import { INITIAL_COMMITS } from "@/lib/previewCommits";
import { usePreviewCommits } from "../../hooks/usePreviewCommits";
import { usePreviewDiff, type PreviewDiff } from "../../lib/previewDiff";
import { PreviewCommits } from "./PreviewCommits";

const hook = vi.mocked(usePreviewCommits);
const setBase = (activeBase: PreviewDiff["activeBase"]) => vi.mocked(usePreviewDiff).mockReturnValue({ activeBase } as PreviewDiff);

beforeEach(() => {
  window.history.replaceState(null, "", "/atlas");
  hook.mockImplementation((_id, _base, on) => (on ? { ...INITIAL_COMMITS, phase: "done" } : null));
  setBase({ key: "repo", repo: "o/r", ref: "main", auto: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PreviewCommits", () => {
  it("is off without the URL parameter, and the switch turns it on in the URL", () => {
    render(<PreviewCommits nodeId="n1" changed />);
    const button = screen.getByRole("button", { name: "By commit" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("region", { name: "Commits in this branch" })).toBeNull();
    fireEvent.click(button);
    expect(new URLSearchParams(window.location.search).get("history")).toBe("by-commit");
    expect(screen.getByRole("button", { name: "By commit" })).toHaveAttribute("aria-pressed", "true");
    expect(hook).toHaveBeenLastCalledWith("n1", "repo", true);
    expect(screen.getByRole("region", { name: "Commits in this branch" })).toBeInTheDocument();
  });

  it("walks against the redline's diff base, and none when it degraded to live main", () => {
    window.history.replaceState(null, "", "/atlas?history=by-commit");
    setBase({ key: "live-main", auto: true });
    render(<PreviewCommits nodeId="n1" changed={false} />);
    expect(hook).toHaveBeenLastCalledWith("n1", null, true);
  });
});
