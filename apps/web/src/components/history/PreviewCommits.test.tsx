// @vitest-environment jsdom
// PreviewCommits: the `?history=by-commit` switch under a preview's overall
// diff, and the diff base it walks the branch against.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("../../lib/previewDiff", () => ({ usePreviewDiff: vi.fn() }));
vi.mock("../../lib/previewMeta", () => ({ usePreviewMeta: vi.fn() }));
vi.mock("../../hooks/usePreviewCommits", () => ({ usePreviewCommits: vi.fn() }));

import { INITIAL_COMMITS } from "@/lib/previewCommits";
import { usePreviewCommits } from "../../hooks/usePreviewCommits";
import { usePreviewDiff, type PreviewDiff } from "../../lib/previewDiff";
import { usePreviewMeta } from "../../lib/previewMeta";
import type { PreviewMeta } from "../../lib/previewMetaTypes";
import { PreviewCommits } from "./PreviewCommits";

const hook = vi.mocked(usePreviewCommits);
const setBase = (activeBase: PreviewDiff["activeBase"]) => vi.mocked(usePreviewDiff).mockReturnValue({ activeBase } as PreviewDiff);
const setMeta = (meta: Partial<PreviewMeta> | null | undefined) => vi.mocked(usePreviewMeta).mockReturnValue(meta as PreviewMeta | null | undefined);
const BASES = { auto: "repo", repo: { repo: "o/r", ref: "main", mergeBase: "mb" } } as PreviewMeta["bases"];

beforeEach(() => {
  window.history.replaceState(null, "", "/atlas");
  hook.mockImplementation((_id, _base, on) => (on ? { ...INITIAL_COMMITS, phase: "done" } : null));
  setBase({ key: "repo", repo: "o/r", ref: "main", auto: true });
  setMeta({ repo: "o/r", bases: BASES });
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

  it("shows only when the diff base is known and the branch adds more than one commit", () => {
    window.history.replaceState(null, "", "/atlas?history=by-commit");
    const withAhead = (aheadBy?: number) => ({ repo: "o/r", bases: { ...BASES!, repo: { ...BASES!.repo!, aheadBy } } });
    const cases: [PreviewDiff["activeBase"], Partial<PreviewMeta> | undefined, boolean][] = [
      [{ key: "repo", repo: "o/r", ref: "main", auto: true }, withAhead(2), true],
      [{ key: "repo", repo: "o/r", ref: "main", auto: true }, withAhead(undefined), true],
      [{ key: "repo", repo: "o/r", ref: "main", auto: true }, withAhead(1), false],
      [{ key: "live-main", auto: true }, withAhead(5), false],
      [null, undefined, false],
      [null, { repo: "o/r", bases: BASES }, false],
      [null, { repo: "o/r" }, false],
    ];
    for (const [active, meta, shown] of cases) {
      setBase(active);
      setMeta(meta);
      render(<PreviewCommits nodeId="n1" changed />);
      expect(screen.queryByRole("button", { name: "By commit" }) !== null).toBe(shown);
      expect(hook.mock.lastCall![2]).toBe(shown);
      cleanup();
    }
  });
});
