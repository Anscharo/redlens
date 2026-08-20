// @vitest-environment jsdom
// Split from CrossViewMarkdown.test.tsx to keep files near the ~150-line
// convention — covers the mount/hash-change scroll effect (once the
// resolver has settled) and a unit-opener paragraph whose bold lead
// contains nested markup (hastText's recursive element branch).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { AtlasBundle } from "@/lib/docsTypes";

vi.mock("./ConceptCensus", () => ({
  ConceptCensus: () => <div data-testid="census-slot" />,
}));

let loadAtlasImpl: (base: string) => Promise<AtlasBundle> = () => Promise.reject(new Error("not configured"));
vi.mock("@/lib/docs", () => ({
  loadAtlas: (base: string) => loadAtlasImpl(base),
}));
vi.mock("@/lib/dataSource", () => ({
  useDataSource: () => ({ base: "/api/test-base/", preview: null }),
}));

import { CrossViewMarkdown } from "./CrossViewMarkdown";

function emptyBundle(): AtlasBundle {
  return { docs: {}, docNoToId: new Map(), byParent: new Map(), atlasCommit: null };
}

const scrollIntoViewMock = vi.fn();

beforeEach(() => {
  loadAtlasImpl = () => Promise.resolve(emptyBundle());
  window.location.hash = "";
  scrollIntoViewMock.mockClear();
  // jsdom has no layout engine and doesn't implement scrollIntoView at all.
  window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
});

afterEach(cleanup);

describe("CrossViewMarkdown — hash scroll effect", () => {
  it("scrolls the hash target into view once headings have rendered", async () => {
    window.location.hash = "#target-heading";
    const raw = "## Target Heading\n\nBody text.";
    render(<CrossViewMarkdown raw={raw} />);
    await screen.findByRole("heading", { name: /Target Heading/ });
    await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "instant", block: "start" }));
  });

  it("does nothing when there is no hash", async () => {
    const raw = "## Some Heading\n\nBody text.";
    render(<CrossViewMarkdown raw={raw} />);
    await screen.findByRole("heading", { name: /Some Heading/ });
    await new Promise((r) => setTimeout(r, 0));
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });
});

describe("CrossViewMarkdown — nested markup inside a unit-opener bold lead", () => {
  it("still stamps the unit-opener id when the bold lead contains nested emphasis", async () => {
    const raw = "**Lifecycle 7 · *Omni* Documents**\n\nBody text.";
    render(<CrossViewMarkdown raw={raw} />);
    await screen.findByText("Body text.");
    const p = screen.getByText((_, el) => el?.tagName === "P" && !!el.querySelector("strong"));
    expect(p).toHaveAttribute("id", "lifecycle-7");
  });
});

describe("CrossViewMarkdown — h3/h4 heading rendering and sticky mode", () => {
  it("renders an h3 with its anchor-hover affordance and an h4 with plain styling", async () => {
    const raw = "### Sub Heading\n\n#### Field Heading\n\nBody text.";
    render(<CrossViewMarkdown raw={raw} />);
    const h3 = await screen.findByRole("heading", { level: 3, name: /Sub Heading/ });
    expect(h3).toHaveAttribute("id", "sub-heading");
    expect(h3.querySelector("a.heading-anchor")).toHaveAttribute("href", "#sub-heading");
    const h4 = screen.getByRole("heading", { level: 4, name: "Field Heading" });
    expect(h4).not.toHaveAttribute("id");
  });

  it("adds the crossview-sticky-headings class when sticky is true", async () => {
    const raw = "## Title\n\nBody.";
    const { container } = render(<CrossViewMarkdown raw={raw} sticky />);
    await screen.findByText("Body.");
    expect(container.querySelector(".crossview-sticky-headings")).toBeInTheDocument();
  });
});

describe("CrossViewMarkdown — non-doc-ref link and code passthrough", () => {
  it("renders a plain external markdown link as a bare <a>, not the internal Link component", async () => {
    const raw = "See [an external site](http://example.com/page) for more.";
    render(<CrossViewMarkdown raw={raw} />);
    const link = await screen.findByRole("link", { name: "an external site" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "http://example.com/page");
  });

  it("renders a non-doc-ref code span as plain code once the resolver has loaded", async () => {
    const raw = "Run `pnpm build` to build.";
    render(<CrossViewMarkdown raw={raw} />);
    const code = await screen.findByText("pnpm build");
    expect(code.tagName).toBe("CODE");
  });
});
