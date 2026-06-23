// @vitest-environment jsdom
// PreviewHistory is the preview-mode history tab — the one path that diverges
// from live NodeHistory: a synthesized "added/changed in this preview" entry on
// top (label + author + renumber + GitHub link + line diff), then the doc's real
// live history below. The diff/patch hooks, the live-history child, DiffView, and
// the meta.json fetch are all mocked so we test PreviewHistory's own composition.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("../../lib/previewDiff", () => ({
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
import { usePreviewDiff, usePreviewPatch } from "../../lib/previewDiff";
import type { PreviewDiff } from "../../lib/previewDiff";
import type { DiffLine } from "../../lib/history";

const mockDiff = vi.mocked(usePreviewDiff);
const mockPatch = vi.mocked(usePreviewPatch);

function setDiff(over: Partial<PreviewDiff>) {
  mockDiff.mockReturnValue({ added: new Set(), changed: new Set(), renumbered: {}, reusedSlot: {}, ...over });
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
  it("shows an 'Added in this preview' entry with the PR label, author and GitHub link", async () => {
    setDiff({ added: new Set(["n1"]) });
    render(<PreviewHistory nodeId="n1" />);

    expect(screen.getByText(/Added\s*in this preview/)).toBeInTheDocument();
    // Label + author come from meta.json (async).
    expect(await screen.findByText(/feat\/x — Add a thing · by alice/)).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: "view on GitHub →" });
    expect(link).toHaveAttribute("href", "https://github.com/sky-ecosystem/next-gen-atlas/pull/42");
  });

  it("shows a 'Changed in this preview' entry for a changed doc", () => {
    setDiff({ changed: new Set(["n1"]) });
    render(<PreviewHistory nodeId="n1" />);
    expect(screen.getByText(/Changed\s*in this preview/)).toBeInTheDocument();
  });

  it("reports 'Unchanged by this preview' for an untouched doc", () => {
    setDiff({});
    render(<PreviewHistory nodeId="n1" />);
    expect(screen.getByText("Unchanged by this preview.")).toBeInTheDocument();
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
    expect(screen.getByText(/renumbered A\.1\.2 → A\.2\.3/)).toBeInTheDocument();
  });

  it("marks a slot-reusing added doc with an asterisk and disclaimer", () => {
    setDiff({ added: new Set(["n1"]), reusedSlot: { n1: { title: "Old Doc", movedTo: "A.9" } } });
    render(<PreviewHistory nodeId="n1" />);
    expect(screen.getByText(/Added\*\s*in this preview/)).toBeInTheDocument();
    expect(screen.getByText(/takes over an existing doc number/)).toBeInTheDocument();
    expect(screen.getByText(/moved to A\.9 in this preview/)).toBeInTheDocument();
  });
});

describe("PreviewHistory live section", () => {
  it("always renders the live atlas history below the preview entry", () => {
    setDiff({ added: new Set(["n1"]) });
    render(<PreviewHistory nodeId="n1" />);
    expect(screen.getByText("On the live atlas")).toBeInTheDocument();
    expect(screen.getByTestId("live-history")).toHaveTextContent("live:n1");
  });

  it("renders the live history even for an unchanged doc", () => {
    setDiff({});
    render(<PreviewHistory nodeId="n1" />);
    expect(screen.getByTestId("live-history")).toBeInTheDocument();
  });
});
