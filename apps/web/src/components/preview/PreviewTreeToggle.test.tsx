// @vitest-environment jsdom
// PreviewTreeToggle sits above the tree in preview mode ("All" ⇄ "Changed
// only"). It renders nothing outside preview mode, and the "Changed only"
// pill carries the added+changed count via PreviewDiffProvider (diff.json).

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PreviewTreeToggle } from "./PreviewTreeToggle";
import { DataSourceContext, type DataSource } from "../../lib/dataSource";
import { PreviewDiffProvider } from "../../lib/previewDiff";
import { PreviewViewProvider } from "../../lib/previewView";

const LIVE_SOURCE: DataSource = { base: "/live/", preview: null };
const PREVIEW_SOURCE: DataSource = { base: "/api/preview/abc/", preview: { id: "pr-88", sha: "abc" } };

function mockDiff(diff: Record<string, unknown> | null) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: diff !== null,
    json: () => Promise.resolve(diff),
  } as Response);
}

function renderToggle(source: DataSource) {
  return render(
    <DataSourceContext.Provider value={source}>
      <PreviewDiffProvider>
        <PreviewViewProvider>
          <PreviewTreeToggle />
        </PreviewViewProvider>
      </PreviewDiffProvider>
    </DataSourceContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PreviewTreeToggle", () => {
  it("renders nothing outside preview mode", () => {
    mockDiff(null);
    const { container } = renderToggle(LIVE_SOURCE);
    expect(container.firstChild).toBeNull();
  });

  it("renders the All / Changed only pills in preview mode", async () => {
    mockDiff({ added: [], changed: [] });
    renderToggle(PREVIEW_SOURCE);
    expect(await screen.findByText("All")).toBeTruthy();
    expect(screen.getByText("Changed only")).toBeTruthy();
  });

  it("shows the added+changed count on the Changed only pill", async () => {
    mockDiff({ added: ["a", "b"], changed: ["c"] });
    renderToggle(PREVIEW_SOURCE);
    expect(await screen.findByText("Changed only · 3")).toBeTruthy();
  });

  it("switches the active pill when Changed only is clicked", async () => {
    mockDiff({ added: [], changed: [] });
    renderToggle(PREVIEW_SOURCE);
    const allBtn = await screen.findByText("All");
    const changedBtn = screen.getByText("Changed only");

    fireEvent.click(changedBtn);

    await waitFor(() => {
      expect(changedBtn.getAttribute("style")).toContain("rgb(255, 255, 255)");
    });
    expect(allBtn.getAttribute("style")).not.toContain("rgb(255, 255, 255)");

    // Clicking All switches back.
    fireEvent.click(allBtn);
    await waitFor(() => {
      expect(changedBtn.getAttribute("style")).not.toContain("rgb(255, 255, 255)");
    });
  });
});
