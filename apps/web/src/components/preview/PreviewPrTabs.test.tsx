// @vitest-environment jsdom
// PreviewPrTabs is the tabbed list under the /preview input: "my recent
// previews" (passed-in entries) and "open atlas prs" (lazily loaded on first
// selection). This colocated file covers its own props/behavior directly;
// PreviewHome.test.tsx exercises it indirectly through PreviewHome.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PreviewPrTabs } from "./PreviewPrTabs";
import type { Entry } from "./types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockOpenPrs(body: unknown, ok = true) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("PreviewPrTabs recent tab", () => {
  it("shows the empty-state message with no entries", () => {
    render(<PreviewPrTabs entries={[]} />);
    expect(screen.getByText("my recent previews")).toBeInTheDocument();
    expect(screen.getByText("No previews opened in this browser yet.")).toBeInTheDocument();
  });

  it("lists entries with title, id, and detail, and links to the preview gate", () => {
    const entries: Entry[] = [{ id: "pull-42", title: "Fix typo", detail: "3 docs", at: 1 }];
    render(<PreviewPrTabs entries={entries} />);
    expect(screen.getByText("my recent previews · 1")).toBeInTheDocument();
    expect(screen.getByText("pull-42")).toBeInTheDocument();
    expect(screen.getByText("Fix typo")).toBeInTheDocument();
    expect(screen.getByText("3 docs")).toBeInTheDocument();
    expect(screen.getByText("pull-42").closest("a")).toHaveAttribute("href", "/preview/pull-42");
  });

  it("omits the title span when an entry has no title", () => {
    const entries: Entry[] = [{ id: "pull-7", detail: "1 doc", at: 1 }];
    render(<PreviewPrTabs entries={entries} />);
    expect(screen.getByText("pull-7")).toBeInTheDocument();
    expect(screen.getByText("1 doc")).toBeInTheDocument();
  });
});

describe("PreviewPrTabs open-prs tab", () => {
  it("does not fetch open PRs until the tab is selected", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<PreviewPrTabs entries={[]} />);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows a loading state, then the open PR list once fetched", async () => {
    mockOpenPrs([{ number: 12, title: "Add rule", author: "sam", draft: true, updatedAt: "" }]);
    render(<PreviewPrTabs entries={[]} />);
    fireEvent.click(screen.getByText("open atlas prs"));
    expect(screen.getByText("Loading open atlas PRs…")).toBeInTheDocument();

    expect(await screen.findByText("Add rule")).toBeInTheDocument();
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.getByText("draft · by sam")).toBeInTheDocument();
    expect(screen.getByText("Add rule").closest("a")).toHaveAttribute("href", "/preview/pull-12");
  });

  it("shows the empty state when there are no open PRs", async () => {
    mockOpenPrs([]);
    render(<PreviewPrTabs entries={[]} />);
    fireEvent.click(screen.getByText("open atlas prs"));
    expect(await screen.findByText("No open PRs against next-gen-atlas right now.")).toBeInTheDocument();
  });

  it("shows an error state with a Retry button on fetch failure, and recovers", async () => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      calls++;
      return calls === 1
        ? Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response)
        : Promise.resolve({
            ok: true,
            json: () => Promise.resolve([{ number: 5, title: "Recovered", author: "amy", draft: false, updatedAt: "" }]),
          } as Response);
    });
    render(<PreviewPrTabs entries={[]} />);
    fireEvent.click(screen.getByText("open atlas prs"));

    const retry = await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(retry);

    expect(await screen.findByText("Recovered")).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it("treats a non-array response body as an empty list", async () => {
    mockOpenPrs({ not: "an array" });
    render(<PreviewPrTabs entries={[]} />);
    fireEvent.click(screen.getByText("open atlas prs"));
    expect(await screen.findByText("No open PRs against next-gen-atlas right now.")).toBeInTheDocument();
  });

  it("links to all PRs on GitHub", () => {
    render(<PreviewPrTabs entries={[]} />);
    const link = screen.getByText("all on github ↗");
    expect(link).toHaveAttribute("href", "https://github.com/sky-ecosystem/next-gen-atlas/pulls");
  });
});
