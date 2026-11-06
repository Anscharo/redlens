// @vitest-environment jsdom
// PreviewTreeToggle sits above the tree in preview mode: "All", then a Filter
// button whose menu picks which changes to show. It renders nothing outside
// preview mode; the menu's counts come from PreviewDiffProvider (diff.json).

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
  window.history.replaceState(null, "", "/");
});

describe("PreviewTreeToggle", () => {
  it("renders nothing outside preview mode", () => {
    mockDiff(null);
    const { container } = renderToggle(LIVE_SOURCE);
    expect(container.firstChild).toBeNull();
  });

  it("renders the All pill and the Filter button in preview mode", async () => {
    mockDiff({ added: [], changed: [] });
    renderToggle(PREVIEW_SOURCE);
    expect(await screen.findByText("All")).toBeTruthy();
    expect(screen.getByText("Filter")).toBeTruthy();
  });

  it("opens the menu with each row's count", async () => {
    mockDiff({ added: ["a", "b"], changed: ["c", "d"], renumberedOnly: ["d"] });
    renderToggle(PREVIEW_SOURCE);
    fireEvent.click(await screen.findByText("Filter"));
    const changed = await screen.findByRole("button", { name: /Changed only/ });
    await waitFor(() => expect(changed.textContent).toContain("4"));
    expect(screen.getByLabelText(/Edited/).closest("label")?.textContent).toContain("2");
    expect(screen.getByLabelText(/Renumber-only changes/).closest("label")?.textContent).toContain("1");
  });

  it("a preset filters, names itself on the button, and closes the menu", async () => {
    mockDiff({ added: ["a"], changed: ["c", "d"], renumberedOnly: ["d"] });
    renderToggle(PREVIEW_SOURCE);
    fireEvent.click(await screen.findByText("Filter"));
    const changedOnly = await screen.findByRole("button", { name: /Changed only/ });
    await waitFor(() => expect(changedOnly.textContent).toContain("3"));
    fireEvent.click(changedOnly);
    expect(await screen.findByText("Changed only")).toBeTruthy();
    expect(screen.getByText("· 3")).toBeTruthy();
    expect(screen.queryByRole("group")).toBeNull();
    expect(window.location.search).toContain("subset=changed");
    expect(window.location.search).not.toContain("change=");
  });

  it("Changed only shows both kinds ticked and nothing excluded", async () => {
    mockDiff({ added: ["a"], changed: ["c", "d"], renumberedOnly: ["d"] });
    renderToggle(PREVIEW_SOURCE);
    fireEvent.click(await screen.findByText("Filter"));
    fireEvent.click(await screen.findByRole("button", { name: /Changed only/ }));
    fireEvent.click(await screen.findByText("Changed only"));
    for (const name of [/^\+?\s*New/, /Edited/]) expect(screen.getByLabelText(name)).toBeChecked();
    expect(screen.getByLabelText(/Retitled/)).not.toBeChecked();
    const box = screen.getByLabelText(/Renumber-only changes/);
    expect(box).not.toBeChecked();
    expect(box.closest("fieldset")?.querySelector("legend")?.textContent).toBe("Exclude");
  });

  it("ticking Exclude › Renumber-only changes hides those docs and keeps the menu open; × clears back to All", async () => {
    mockDiff({ added: ["a"], changed: ["c", "d"], renumberedOnly: ["d"] });
    renderToggle(PREVIEW_SOURCE);
    fireEvent.click(await screen.findByText("Filter"));
    const box = await screen.findByLabelText(/Renumber-only changes/);
    await waitFor(() => expect(box).not.toBeDisabled());
    fireEvent.click(box);
    await waitFor(() => expect(box).toBeChecked());
    expect(screen.getByText("Changed only · No renumbers")).toBeTruthy();
    expect(screen.getByText("· 2")).toBeTruthy();
    expect(window.location.search).toContain("change=no-renumbered");
    fireEvent.click(screen.getByLabelText("Clear filter"));
    await waitFor(() => expect(window.location.search).not.toContain("subset"));
    expect(window.location.search).not.toContain("change");
  });

  it("greys out the rows an older bundle cannot answer", async () => {
    mockDiff({ added: ["a"], changed: ["c"] });
    renderToggle(PREVIEW_SOURCE);
    fireEvent.click(await screen.findByText("Filter"));
    await waitFor(() => expect(screen.getByLabelText(/Retitled/)).not.toBeDisabled());
    expect(screen.getByLabelText(/Renumber-only changes/)).toBeDisabled();
    expect(screen.getByLabelText(/Edited/)).not.toBeDisabled();
  });
});
