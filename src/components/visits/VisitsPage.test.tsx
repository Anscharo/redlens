// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { AtlasNode } from "../../types";
import type { VisitEvent } from "../../lib/visitHistory";

function node(id: string, doc_no: string, title: string): AtlasNode {
  return { id, doc_no, title, type: "Core", depth: 3, parentId: null, content: "", order: 0, addressRefs: [] };
}

const DOCS: Record<string, AtlasNode> = {
  a: node("a", "A.3.1.1", "Deep governance doc"),
  b: node("b", "A.3.1.2", "Another governance doc"),
  tree: node("tree", "A.3.1", "Governance branch"),
  scope: node("scope", "A.3", "The Financial Scope"),
};

let log: { events: VisitEvent[]; loaded: boolean } = { events: [], loaded: true };
const clearHistory = vi.fn(() => Promise.resolve());
vi.mock("../../lib/visitHistory", async (orig) => ({
  ...(await orig<typeof import("../../lib/visitHistory")>()),
  useVisitLog: () => log,
  clearHistory: () => clearHistory(),
}));
vi.mock("../../lib/docs", () => ({ loadDocs: () => Promise.resolve(DOCS) }));
vi.mock("../../lib/dataSource", () => ({ useDataSource: () => ({ base: "/", preview: false }) }));
vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));

import { VisitsPage } from "./VisitsPage";

beforeEach(() => {
  log = { events: [], loaded: true };
  clearHistory.mockClear();
});

afterEach(cleanup);

describe("VisitsPage", () => {
  it("distinguishes 'still loading' from 'nothing recorded'", () => {
    log = { events: [], loaded: false };
    const { rerender } = render(<VisitsPage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    log = { events: [], loaded: true };
    rerender(<VisitsPage />);
    expect(screen.getByText(/No history yet/)).toBeInTheDocument();
  });

  it("leaves the view count off the recency card — it answers when, not how often", () => {
    log = {
      events: [
        { path: "/atlas?id=a", label: "Deep governance doc", at: Date.now() - 3 * 3600_000 },
        { path: "/atlas?id=a", label: "Deep governance doc", at: Date.now() - 2 * 3600_000 },
      ],
      loaded: true,
    };
    render(<VisitsPage />);
    const recent = screen
      .getByText("Recently viewed documents")
      .closest("article")!;
    expect(recent).not.toHaveTextContent("View Count");
    expect(recent).toHaveTextContent("2 hours ago"); // when, not how often
    expect(recent.querySelectorAll(".tabular-nums")).toHaveLength(0); // no count cells
    // The same document still carries its count on the most-viewed card.
    const top = screen.getByText("Most viewed documents").closest("article")!;
    expect(top).toHaveTextContent("View Count");
    expect(top.querySelectorAll(".tabular-nums")).toHaveLength(1);
  });

  it("lists visited documents with their counts once docs.json lands", async () => {
    log = {
      events: [
        { path: "/atlas?id=a", label: "Deep governance doc", at: 10 },
        { path: "/atlas?id=a", label: "Deep governance doc", at: 20 },
        { path: "/atlas?id=b", label: "Another governance doc", at: 30 },
      ],
      loaded: true,
    };
    render(<VisitsPage />);
    expect(screen.getAllByText("Deep governance doc").length).toBeGreaterThan(0);
    // Doc numbers come from docs.json, which arrives a tick later.
    await waitFor(() => expect(screen.getAllByText("A.3.1.1").length).toBeGreaterThan(0));
    const link = screen.getAllByText("Deep governance doc")[0].closest("a");
    expect(link).toHaveAttribute("href", "/atlas?id=a");
  });

  it("says how long ago each recent document was opened", () => {
    log = {
      events: [
        { path: "/atlas?id=a", label: "Deep governance doc", at: Date.now() - 3 * 3600_000 },
        { path: "/atlas?id=b", label: "Another governance doc", at: Date.now() - 40_000 },
      ],
      loaded: true,
    };
    render(<VisitsPage />);
    expect(screen.getByText("3 hours ago")).toBeInTheDocument();
    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("heads a tree with its wildcard pattern, scope and root document", async () => {
    log = {
      events: [
        { path: "/atlas?id=a", label: "Deep governance doc", at: 10 },
        { path: "/atlas?id=b", label: "Another governance doc", at: 30 },
      ],
      loaded: true,
    };
    render(<VisitsPage />);
    const toggle = await screen.findByRole("button", { name: /A\.3\.1\.X/ });
    expect(toggle).toHaveTextContent("A.3.1.X…");
    expect(toggle).toHaveTextContent("The Financial Scope");
    expect(toggle).toHaveTextContent("Governance branch");
  });

  it("opens a tree to reveal the documents behind its count", async () => {
    log = {
      events: [
        { path: "/atlas?id=a", label: "Deep governance doc", at: 10 },
        { path: "/atlas?id=b", label: "Another governance doc", at: 30 },
      ],
      loaded: true,
    };
    render(<VisitsPage />);
    const toggle = await screen.findByRole("button", { name: /A\.3\.1\.X/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Both member docs are now listed under the group (plus their own cards).
    expect(screen.getAllByText("Deep governance doc").length).toBe(3);
  });

  it("shows report visits with the filters that were set", () => {
    log = {
      events: [{ path: "/reports/rewards", label: "Integrator Reward Relationships", at: 10, params: "cat=spark" }],
      loaded: true,
    };
    render(<VisitsPage />);
    const link = screen.getByText("Integrator Reward Relationships").closest("a");
    expect(link).toHaveAttribute("href", "/reports/rewards?cat=spark");
    expect(screen.getByText("category: spark")).toBeInTheDocument();
  });

  it("clears the log after confirmation only", () => {
    log = { events: [{ path: "/atlas?id=a", label: "Deep governance doc", at: 10 }], loaded: true };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<VisitsPage />);
    fireEvent.click(screen.getByText("clear history"));
    expect(clearHistory).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByText("clear history"));
    expect(clearHistory).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });
});
