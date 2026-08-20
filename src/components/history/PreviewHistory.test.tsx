// @vitest-environment jsdom
// PreviewHistory is the preview-mode history tab — the one path that diverges
// from live NodeHistory: a synthesized "added/changed in this preview" entry on
// top (label + author + renumber + GitHub link + line diff), then the doc's real
// live history below. The diff/patch hooks, the live-history child, DiffView, and
// the meta.json fetch are all mocked so we test PreviewHistory's own composition.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/previewDiff", () => ({
  usePreviewDiff: vi.fn(),
  usePreviewPatch: vi.fn(),
}));
vi.mock("./NodeHistory", () => ({
  NodeHistory: ({ nodeId }: { nodeId: string }) => <div data-testid="live-history">live:{nodeId}</div>,
}));
vi.mock("./DiffView", () => ({
  DiffView: ({ lines }: { lines: unknown[] }) => <div data-testid="diff-view">{lines.length} lines</div>,
}));

import { PreviewHistory } from "./PreviewHistory";
import { usePreviewDiff, usePreviewPatch } from "@/lib/previewDiff";
import type { PreviewDiff } from "@/lib/previewDiff";
import type { DiffLine } from "@/lib/history";

const mockDiff = vi.mocked(usePreviewDiff);
const mockPatch = vi.mocked(usePreviewPatch);

function setDiff(over: Partial<PreviewDiff>) {
  mockDiff.mockReturnValue({ added: new Set(), changed: new Set(), renumbered: {}, reusedSlot: {}, identitySwap: {}, formerUuid: {}, ...over });
}

const PR_META = {
  ref: "feat/x",
  kind: "pr",
  repo: "sky-ecosystem/next-gen-atlas",
  sha: "abc123",
  prNumber: 42,
  prTitle: "Add a thing",
  prAuthor: "alice",
};

function mockMeta(meta: Record<string, unknown> = PR_META) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: () => Promise.resolve(meta) } as Response);
}

beforeEach(() => {
  setDiff({});
  mockPatch.mockReturnValue(null);
  mockMeta();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PreviewHistory preview entry", () => {
  it("shows an 'Added in this preview' entry with the PR line, title and GitHub link", async () => {
    setDiff({ added: new Set(["n1"]) });
    render(<PreviewHistory nodeId="n1" />);

    // Wording + PR line come from meta.json (async): the source is a pull request,
    // not "this preview" — it isn't the preview that changed anything.
    expect(await screen.findByText(/Added\s*in this pull request/)).toBeInTheDocument();
    // PR number + title, laid out like a live entry:
    // "PR n" then the title below it. The author is deliberately not shown.
    expect(await screen.findByText("PR 42")).toBeInTheDocument();
    expect(await screen.findByText("Add a thing")).toBeInTheDocument();
    expect(screen.queryByText(/alice/)).not.toBeInTheDocument();
    const link = await screen.findByRole("link", { name: "view on GitHub" });
    expect(link).toHaveAttribute("href", "https://github.com/sky-ecosystem/next-gen-atlas/pull/42");
  });

  it("puts the branch in the title slot when the preview has no PR", async () => {
    setDiff({ changed: new Set(["n1"]) });
    mockMeta({ ref: "feat/x", kind: "branch", repo: "someone/next-gen-atlas", sha: "abc123" });
    render(<PreviewHistory nodeId="n1" />);
    expect(await screen.findByText("Branch: someone/feat/x")).toBeInTheDocument();
    expect(screen.getByText(/Changed\s*in this branch/)).toBeInTheDocument();
    expect(screen.queryByText(/^PR /)).not.toBeInTheDocument();
  });

  it("shows a 'Changed in this pull request' entry for a changed doc", async () => {
    setDiff({ changed: new Set(["n1"]) });
    render(<PreviewHistory nodeId="n1" />);
    expect(await screen.findByText(/Changed\s*in this pull request/)).toBeInTheDocument();
  });

  it("reports the doc unchanged by the source for an untouched doc", async () => {
    setDiff({});
    render(<PreviewHistory nodeId="n1" />);
    expect(await screen.findByText("Unchanged by this pull request.")).toBeInTheDocument();
  });

  it("renders the line diff when a patch is available", () => {
    setDiff({ changed: new Set(["n1"]) });
    mockPatch.mockReturnValue([["+", "added line"], ["-", "removed line"]] as DiffLine[]);
    render(<PreviewHistory nodeId="n1" />);
    expect(screen.getByTestId("diff-view")).toHaveTextContent("2 lines");
  });

  it("shows the renumber note when a changed doc moved doc number", () => {
    setDiff({ changed: new Set(["n1"]), renumbered: { n1: ["A.1.2", "A.2.3"] } });
    render(<PreviewHistory nodeId="n1" />);
    // The arrow is its own (enlarged) span, so match on the <p>'s full textContent.
    expect(
      screen.getByText(
        (_content, el) => el?.tagName === "P" && el.textContent === "renumbered A.1.2 → A.2.3",
      ),
    ).toBeInTheDocument();
  });

  it("marks a slot-reusing added doc with a superscript asterisk and disclaimer", async () => {
    setDiff({ added: new Set(["n1"]), reusedSlot: { n1: { title: "Old Doc", movedTo: "A.9" } } });
    render(<PreviewHistory nodeId="n1" />);
    expect(await screen.findByText(/Added\s*in this pull request/)).toBeInTheDocument();
    // The marker is a superscript footnote pointing at the note below.
    expect(screen.getAllByText("*").map((el) => el.tagName)).toEqual(["SUP", "SUP"]);
    expect(screen.getByText(/takes over an existing doc number/)).toBeInTheDocument();
    expect(screen.getByText(/moved to A\.9 in this pull request/)).toBeInTheDocument();
  });

  it("shows the ⚠ identity-swap warning with old/new title and relocation target", () => {
    setDiff({
      changed: new Set(["n1"]),
      identitySwap: {
        n1: { oldTitle: "Operational GovOps", newTitle: "Sky Primitives", movedTo: { id: "y", doc_no: "A.9", title: "Archive" } },
      },
    });
    render(<PreviewHistory nodeId="n1" />);
    expect(screen.getByText(/Identity changed/)).toBeInTheDocument();
    expect(screen.getByText(/moved to A\.9/)).toBeInTheDocument();
    // The ⚠ glyph is sized up relative to the 11px mono around it.
    expect(screen.getByText("⚠")).toHaveStyle({ fontSize: "1.25em" });
  });

  it("notes when a swapped UUID's previous content is not present in the preview", () => {
    setDiff({
      changed: new Set(["n1"]),
      identitySwap: { n1: { oldTitle: "Operational GovOps", newTitle: "Sky Primitives" } },
    });
    render(<PreviewHistory nodeId="n1" />);
    expect(screen.getByText(/previous content is not present in this preview/)).toBeInTheDocument();
  });

  it("shows the ⚠ former-UUID warning on a doc that received relocated content", () => {
    setDiff({
      added: new Set(["n2"]),
      formerUuid: { n2: { previousId: "x", previousTitle: "Operational GovOps", previousDocNo: "A.6.1.2.2.2" } },
    });
    render(<PreviewHistory nodeId="n2" />);
    expect(screen.getByText(/previously appeared under a different UUID/)).toBeInTheDocument();
  });
});

describe("PreviewHistory live section", () => {
  it("always renders the live atlas history below the preview entry", () => {
    setDiff({ added: new Set(["n1"]) });
    render(<PreviewHistory nodeId="n1" />);
    expect(screen.getByText("On the Live Atlas")).toBeInTheDocument();
    expect(screen.getByTestId("live-history")).toHaveTextContent("live:n1");
  });

  it("renders the live history even for an unchanged doc", () => {
    setDiff({});
    render(<PreviewHistory nodeId="n1" />);
    expect(screen.getByTestId("live-history")).toBeInTheDocument();
  });
});
