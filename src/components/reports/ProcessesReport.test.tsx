// @vitest-environment jsdom
// Regression test for the row-expand filter wipe: `toggle()` used to rebuild
// the URL from scratch (`?expanded=<uuid>`), dropping any active `status` /
// `shape` / `category` / `ignored` filter params from useUrlState. Fixed by
// folding the expand toggle into the existing URLSearchParams, mirroring
// ConstellationsPage's selectEntity.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("../../lib/docs", () => ({
  loadAtlas: () =>
    Promise.resolve({
      docs: {
        "uuid-1": {
          id: "uuid-1",
          doc_no: "A.1",
          title: "First Process",
          type: "Core",
          depth: 1,
          parentId: null,
          content: "content one",
          order: 1,
          addressRefs: [],
        },
      },
      byParent: new Map(),
      docNoToId: new Map([["A.1", "uuid-1"]]),
      atlasCommit: null,
    }),
}));

vi.mock("../../lib/processesIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/processesIndex")>();
  return {
    ...actual,
    loadProcesses: () =>
      Promise.resolve([
        { uuid: "uuid-1", category: "Governance", shape: "inline", status: "active" },
      ]),
  };
});

// The full markdown renderer isn't relevant to URL/filter behavior and pulls
// in a lazy-loaded chunk — stub it out.
vi.mock("../NodeContent", () => ({
  NodeContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

import { ProcessesReport } from "./ProcessesReport";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("ProcessesReport row expand", () => {
  it("preserves active filter params in the URL when a row is expanded", async () => {
    window.history.pushState({}, "", "/reports/processes?status=active&shape=inline&category=Governance&ignored=1");

    render(<ProcessesReport onNavigate={() => {}} />);

    const row = await screen.findByText("First Process");
    fireEvent.click(row.closest("tr")!);

    // The row toggle must fold `expanded` into the existing params, not replace them.
    const params = new URLSearchParams(window.location.search);
    expect(params.get("expanded")).toBe("uuid-1");
    expect(params.get("status")).toBe("active");
    expect(params.get("shape")).toBe("inline");
    expect(params.get("category")).toBe("Governance");
    expect(params.get("ignored")).toBe("1");
  });

  it("removes only the expanded param when the same row is toggled closed", async () => {
    window.history.pushState({}, "", "/reports/processes?status=active&expanded=uuid-1");

    render(<ProcessesReport onNavigate={() => {}} />);

    const row = await screen.findByText("First Process");
    fireEvent.click(row.closest("tr")!);

    const params = new URLSearchParams(window.location.search);
    expect(params.has("expanded")).toBe(false);
    expect(params.get("status")).toBe("active");
  });
});
