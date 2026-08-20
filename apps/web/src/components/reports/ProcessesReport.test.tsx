// @vitest-environment jsdom
// Regression test for the row-expand filter wipe: `toggle()` used to rebuild
// the URL from scratch (`?expanded=<uuid>`), dropping any active `status` /
// `shape` / `category` / `ignored` filter params from useUrlState. Fixed by
// folding the expand toggle into the existing URLSearchParams, mirroring
// ConstellationsPage's selectEntity.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement scrollIntoView; the expand effect calls it inside a
// requestAnimationFrame, so without this stub the throw surfaces as an unhandled
// error and fails the run.
Element.prototype.scrollIntoView = vi.fn();

// Richer fixture: three processes spanning two categories, both shapes, and
// both statuses, so filtering/search/curation behavior is actually exercised.
// uuid-1 is kept identical to the original minimal fixture so the pre-existing
// row-expand tests below (which only assert on "First Process") keep passing.
function makeNode(overrides: Partial<Record<string, unknown>> & { id: string; doc_no: string; title: string }) {
  return {
    depth: 1,
    parentId: null,
    order: 1,
    addressRefs: [],
    type: "Core",
    content: `content for ${overrides.title}`,
    ...overrides,
  };
}

vi.mock("../../lib/docs", () => ({
  loadAtlas: () =>
    Promise.resolve({
      docs: {
        "uuid-1": makeNode({ id: "uuid-1", doc_no: "A.1", title: "First Process", content: "content one" }),
        "uuid-2": makeNode({ id: "uuid-2", doc_no: "A.2", title: "Second Process" }),
        "uuid-3": makeNode({ id: "uuid-3", doc_no: "B.1", title: "Third Process" }),
        "uuid-3-step-1": makeNode({ id: "uuid-3-step-1", doc_no: "B.1.1", title: "Third Process Step One" }),
      },
      byParent: new Map(),
      docNoToId: new Map([
        ["A.1", "uuid-1"],
        ["A.2", "uuid-2"],
        ["B.1", "uuid-3"],
        ["B.1.1", "uuid-3-step-1"],
      ]),
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
        { uuid: "uuid-2", category: "Governance", shape: "inline", status: "active" },
        { uuid: "uuid-3", category: "Settlement", shape: "child", status: "deferred-stub" },
      ]),
  };
});

// The full markdown renderer isn't relevant to URL/filter behavior and pulls
// in a lazy-loaded chunk — stub it out.
vi.mock("../NodeContent", () => ({
  NodeContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

import { ProcessesReport } from "./ProcessesReport";

URL.createObjectURL = vi.fn(() => "blob:x");
URL.revokeObjectURL = vi.fn();
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
  localStorage.clear();
});

describe("ProcessesReport row expand", () => {
  it("preserves active filter params in the URL when a row is expanded", async () => {
    window.history.pushState({}, "", "/reports/processes?status=active&shape=inline&category=Governance&ignored=1");

    render(<ProcessesReport onNavigate={() => {}} query="" mode="broad" />);

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

    render(<ProcessesReport onNavigate={() => {}} query="" mode="broad" />);

    const row = await screen.findByText("First Process");
    fireEvent.click(row.closest("tr")!);

    const params = new URLSearchParams(window.location.search);
    expect(params.has("expanded")).toBe(false);
    expect(params.get("status")).toBe("active");
  });
});

describe("ProcessesReport filtering", () => {
  it("shows all three processes across both categories with no filters active", async () => {
    render(<ProcessesReport onNavigate={() => {}} query="" mode="broad" />);
    await screen.findByText("First Process");
    expect(screen.getByText("Second Process")).toBeInTheDocument();
    expect(screen.getByText("Third Process")).toBeInTheDocument();
    expect(screen.getByText("3 processes")).toBeInTheDocument();
    expect(screen.getAllByText("Governance").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Settlement").length).toBeGreaterThan(0);
  });

  it("filters to a single category when its pill is clicked", async () => {
    render(<ProcessesReport onNavigate={() => {}} query="" mode="broad" />);
    await screen.findByText("First Process");

    fireEvent.click(screen.getByRole("button", { name: "Settlement" }));

    expect(screen.queryByText("First Process")).not.toBeInTheDocument();
    expect(screen.queryByText("Second Process")).not.toBeInTheDocument();
    expect(screen.getByText("Third Process")).toBeInTheDocument();
    expect(screen.getByText("1 processes")).toBeInTheDocument();

    const params = new URLSearchParams(window.location.search);
    expect(params.get("category")).toBe("Settlement");
  });

  it("clears the category filter when the same pill is clicked again", async () => {
    render(<ProcessesReport onNavigate={() => {}} query="" mode="broad" />);
    await screen.findByText("First Process");

    const pill = screen.getByRole("button", { name: "Settlement" });
    fireEvent.click(pill);
    fireEvent.click(pill);

    expect(screen.getByText("First Process")).toBeInTheDocument();
    expect(screen.getByText("Third Process")).toBeInTheDocument();
    const params = new URLSearchParams(window.location.search);
    expect(params.has("category")).toBe(false);
  });

  it("filters by status pill", async () => {
    render(<ProcessesReport onNavigate={() => {}} query="" mode="broad" />);
    await screen.findByText("First Process");

    fireEvent.click(screen.getByRole("button", { name: "deferred-stub" }));

    expect(screen.queryByText("First Process")).not.toBeInTheDocument();
    expect(screen.getByText("Third Process")).toBeInTheDocument();
  });

  it("filters by shape pill", async () => {
    render(<ProcessesReport onNavigate={() => {}} query="" mode="broad" />);
    await screen.findByText("First Process");

    fireEvent.click(screen.getByRole("button", { name: "child" }));

    expect(screen.queryByText("First Process")).not.toBeInTheDocument();
    expect(screen.queryByText("Second Process")).not.toBeInTheDocument();
    expect(screen.getByText("Third Process")).toBeInTheDocument();
  });

  it("filters rows via the query prop (title search)", async () => {
    render(<ProcessesReport onNavigate={() => {}} query="Second" mode="broad" />);
    // The matched query text is highlighted (split across a <mark>), so match
    // on the link's accessible name rather than a literal text node.
    await screen.findByRole("link", { name: "Second Process" });

    expect(screen.queryByText("First Process")).not.toBeInTheDocument();
    expect(screen.queryByText("Third Process")).not.toBeInTheDocument();
    expect(screen.getByText("1 processes")).toBeInTheDocument();
  });

  it("shows the no-rows-match state when the query matches nothing", async () => {
    render(<ProcessesReport onNavigate={() => {}} query="zzz-nonexistent" mode="broad" />);
    await screen.findByText("0 processes");
    expect(screen.queryByText("First Process")).not.toBeInTheDocument();
  });

  it("expanding a child-shape process lists its doc_no step children", async () => {
    render(<ProcessesReport onNavigate={() => {}} query="" mode="broad" />);
    const row = await screen.findByText("Third Process");

    fireEvent.click(row.closest("tr")!);

    // "1 step" appears both in the Steps column and the expanded step count
    // header, so assert on the (unambiguous) step child instead of that text.
    expect(screen.getAllByText("1 step").length).toBeGreaterThan(0);
    expect(screen.getByText("Third Process Step One")).toBeInTheDocument();
  });

  it("downloads the full CSV report", async () => {
    render(<ProcessesReport onNavigate={() => {}} query="" mode="broad" />);
    await screen.findByText("First Process");

    fireEvent.click(screen.getByText("Download full report"));

    expect(URL.createObjectURL).toHaveBeenCalled();
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as Blob;
    const text = await blob.text();
    expect(text).toContain("First Process");
    expect(text).toContain("Second Process");
    expect(text).toContain("Third Process");
  });
});

describe("ProcessesReport curation", () => {
  it("marks a row as NonProcess from the expanded panel and reflects it in the curation bar", async () => {
    render(<ProcessesReport onNavigate={() => {}} query="" mode="broad" />);
    const row = await screen.findByText("First Process");

    // No curation bar until something is marked.
    expect(screen.queryByText(/marked locally as NonProcess/)).not.toBeInTheDocument();

    fireEvent.click(row.closest("tr")!);
    fireEvent.click(screen.getByText("Mark as NonProcess"));
    fireEvent.click(screen.getByText("Confirm"));

    // Marked row disappears from the default (showIgnored=false) view...
    expect(screen.queryByText("First Process")).not.toBeInTheDocument();
    // ...but the curation bar now reports it.
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText(/marked locally as NonProcess/)).toBeInTheDocument();
  });

  it("reveals a marked row again via Show ignored, with an ignored badge", async () => {
    render(<ProcessesReport onNavigate={() => {}} query="" mode="broad" />);
    const row = await screen.findByText("First Process");

    fireEvent.click(row.closest("tr")!);
    fireEvent.click(screen.getByText("Mark as NonProcess"));
    fireEvent.click(screen.getByText("Confirm"));

    fireEvent.click(screen.getByText("Show ignored"));

    const revived = screen.getByText("First Process");
    expect(revived).toBeInTheDocument();
    expect(within(revived.closest("tr")!).getByText("ignored")).toBeInTheDocument();

    const params = new URLSearchParams(window.location.search);
    expect(params.get("ignored")).toBe("1");
  });

  it("unmarks a row from the expanded panel, clearing the curation bar", async () => {
    render(<ProcessesReport onNavigate={() => {}} query="" mode="broad" />);
    const row = await screen.findByText("First Process");

    fireEvent.click(row.closest("tr")!);
    fireEvent.click(screen.getByText("Mark as NonProcess"));
    fireEvent.click(screen.getByText("Confirm"));
    fireEvent.click(screen.getByText("Show ignored"));

    fireEvent.click(screen.getByText("Unmark"));

    expect(screen.queryByText(/marked locally as NonProcess/)).not.toBeInTheDocument();
    expect(screen.getByText("First Process")).toBeInTheDocument();
  });

  it("exports the expected decisions.json shape after marking a row", async () => {
    render(<ProcessesReport onNavigate={() => {}} query="" mode="broad" />);
    const row = await screen.findByText("First Process");

    fireEvent.click(row.closest("tr")!);
    fireEvent.click(screen.getByText("Mark as NonProcess"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "role definition" } });
    fireEvent.click(screen.getByText("Confirm"));

    fireEvent.click(screen.getByText("Download JSON"));

    expect(URL.createObjectURL).toHaveBeenCalled();
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as Blob;
    const text = await blob.text();
    const decisions = JSON.parse(text);
    expect(decisions).toEqual([{ uuid: "uuid-1", verdict: "ignore", reason: "role definition" }]);
  });

  it("clears all local marks via Clear all", async () => {
    render(<ProcessesReport onNavigate={() => {}} query="" mode="broad" />);
    const row = await screen.findByText("First Process");

    fireEvent.click(row.closest("tr")!);
    fireEvent.click(screen.getByText("Mark as NonProcess"));
    fireEvent.click(screen.getByText("Confirm"));

    fireEvent.click(screen.getByText("Clear all"));

    expect(screen.queryByText(/marked locally as NonProcess/)).not.toBeInTheDocument();
    expect(screen.getByText("First Process")).toBeInTheDocument();
  });
});
