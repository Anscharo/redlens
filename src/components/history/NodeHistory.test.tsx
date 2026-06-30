// @vitest-environment jsdom
// NodeHistory drives the live-atlas history tab: loading → rows → empty, newest
// first, plus the pre-markdown-era footer on the migration PR. loadHistory is
// mocked (its real impl fetches + caches per id); EntryRow renders for real.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("../../lib/history", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/history")>();
  return { ...actual, loadHistory: vi.fn() };
});

import { NodeHistory } from "./NodeHistory";
import { loadHistory, type HistoryEntry } from "../../lib/history";

const mockLoad = vi.mocked(loadHistory);

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return { date: "2025-01-01", commitHash: "abc1234", changeType: "modified", ...over };
}

beforeEach(() => mockLoad.mockReset());
afterEach(cleanup);

describe("NodeHistory states", () => {
  it("shows the loading placeholder before the fetch resolves", async () => {
    mockLoad.mockResolvedValue([]);
    render(<NodeHistory nodeId="n1" />);
    // Synchronous: the resolution microtask hasn't run yet, so we're still loading.
    expect(screen.getByText("loading history…")).toBeInTheDocument();
    // Flush the pending update so the test ends cleanly (no act warning).
    await screen.findByText("no history recorded");
  });

  it("renders 'no history recorded' for a null result", async () => {
    mockLoad.mockResolvedValue(null);
    render(<NodeHistory nodeId="n2" />);
    expect(await screen.findByText("no history recorded")).toBeInTheDocument();
  });

  it("renders 'no history recorded' for an empty array", async () => {
    mockLoad.mockResolvedValue([]);
    render(<NodeHistory nodeId="n3" />);
    expect(await screen.findByText("no history recorded")).toBeInTheDocument();
  });

  it("renders an entry row with its PR title", async () => {
    mockLoad.mockResolvedValue([entry({ pr: 42, prTitle: "Tweak the thing", changeType: "added" })]);
    render(<NodeHistory nodeId="n4" />);
    expect(await screen.findByText("Tweak the thing")).toBeInTheDocument();
    expect(screen.getByText("#42")).toBeInTheDocument();
  });

  it("sorts entries newest-first by date", async () => {
    mockLoad.mockResolvedValue([
      entry({ date: "2025-01-01", commitHash: "old1234", summary: "older change" }),
      entry({ date: "2025-06-01", commitHash: "new5678", summary: "newer change" }),
    ]);
    render(<NodeHistory nodeId="n5" />);
    const newer = await screen.findByText("newer change");
    const older = screen.getByText("older change");
    // DOCUMENT_POSITION_FOLLOWING (4) set ⇒ newer precedes older in DOM order.
    expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("appends the pre-markdown footer under the migration PR (no reconstructed entries)", async () => {
    mockLoad.mockResolvedValue([entry({ pr: 117, prTitle: "Migrate To Markdown File" })]);
    render(<NodeHistory nodeId="n6" />);
    expect(await screen.findByText("view HTML-era diff →")).toBeInTheDocument();
  });

  it("shows the reconstruction disclaimer before HTML-era entries and hides the legacy footer", async () => {
    mockLoad.mockResolvedValue([
      entry({ date: "2025-11-21", pr: 117, prTitle: "Migrate To Markdown File", summary: "migration" }),
      entry({ date: "2025-09-01", commitHash: "html0001", era: "html", summary: "an html-era change" }),
    ]);
    render(<NodeHistory nodeId="n7" />);
    expect(await screen.findByText(/Pre-#117 history is reconstructed/i)).toBeInTheDocument();
    expect(screen.getByText("view original HTML →")).toBeInTheDocument();
    // the legacy "no per-doc identities" footer is suppressed once we have real reconstructed entries
    expect(screen.queryByText("view HTML-era diff →")).not.toBeInTheDocument();
  });

  it("badges only the AI/human HTML-era entries, never deterministic or markdown ones", async () => {
    mockLoad.mockResolvedValue([
      entry({ date: "2025-09-03", commitHash: "h1", era: "html", method: "ai", summary: "ai-resolved" }),
      entry({ date: "2025-09-02", commitHash: "h2", era: "html", method: "human", summary: "human-resolved" }),
      entry({ date: "2025-09-01", commitHash: "h3", era: "html", summary: "deterministic (no method)" }),
    ]);
    render(<NodeHistory nodeId="n8" />);
    await screen.findByText("ai-resolved");
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("human")).toBeInTheDocument();
    // exactly one AI badge + one human badge — the deterministic entry adds none
    expect(screen.getAllByText(/^(AI|human)$/)).toHaveLength(2);
  });
});
