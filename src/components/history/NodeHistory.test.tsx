// @vitest-environment jsdom
// NodeHistory drives the live-atlas history tab: loading → rows → empty, newest
// first, plus the pre-markdown-era footer on the migration PR. loadHistory is
// mocked (its real impl fetches + caches per id); EntryRow renders for real.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
    expect(await screen.findByText("view original HTML →")).toBeInTheDocument();
  });

  it("hides HTML-era entries by default behind a toggle, and reveals them on click", async () => {
    mockLoad.mockResolvedValue([
      entry({ date: "2025-11-21", pr: 117, prTitle: "Migrate To Markdown File", summary: "migration" }),
      entry({ date: "2025-09-01", commitHash: "html0001", era: "html", summary: "an html-era change" }),
    ]);
    render(<NodeHistory nodeId="n7" />);

    await screen.findByText("migration");
    expect(screen.queryByText("an html-era change")).not.toBeInTheDocument();
    expect(screen.queryByText(/Pre-#117 history is reconstructed/i)).not.toBeInTheDocument();
    // the legacy "no per-doc identities" footer is also suppressed — this doc DOES have
    // reconstructed entries, they're just toggled off, so the footer would be misleading
    expect(screen.queryByText(/79 prior commits exist/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View Reconstructed History" }));

    expect(await screen.findByText("an html-era change")).toBeInTheDocument();
    expect(screen.getByText(/Pre-#117 history is reconstructed/i)).toBeInTheDocument();
    expect(screen.getByText("view original HTML →")).toBeInTheDocument();
  });

  it("badges only the AI/human HTML-era entries, never deterministic or markdown ones", async () => {
    mockLoad.mockResolvedValue([
      entry({ date: "2025-09-03", commitHash: "h1", era: "html", method: "ai", summary: "ai-resolved" }),
      entry({ date: "2025-09-02", commitHash: "h2", era: "html", method: "human", summary: "human-resolved" }),
      entry({ date: "2025-09-01", commitHash: "h3", era: "html", summary: "deterministic (no method)" }),
    ]);
    render(<NodeHistory nodeId="n8" />);
    fireEvent.click(await screen.findByRole("button", { name: "View Reconstructed History" }));

    await screen.findByText("ai-resolved");
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("human")).toBeInTheDocument();
    // exactly one AI badge + one human badge — the deterministic entry adds none
    expect(screen.getAllByText(/^(AI|human)$/)).toHaveLength(2);
  });

  it("hides mip/genesis/severed entries behind the same toggle as html era, with their own disclaimer", async () => {
    mockLoad.mockResolvedValue([
      entry({ date: "2025-01-01", commitHash: "abcdef1", commitSeq: 500, summary: "modern edit" }),
      entry({
        date: "2024-09-02", commitHash: "genesis:bafkreih7", era: "genesis", changeType: "added",
        commitSeq: -20000, summary: "Present at Atlas v2 genesis",
      }),
      entry({
        date: "2023-11-06", commitHash: "mip:104:14.3", era: "mip", changeType: "added",
        commitSeq: -29000, summary: "Proposed in MIP104 §14.3",
      }),
    ]);
    render(<NodeHistory nodeId="n9" />);
    await screen.findByText("modern edit");
    expect(screen.queryByText("Proposed in MIP104 §14.3")).not.toBeInTheDocument();
    expect(screen.queryByText("Present at Atlas v2 genesis")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View Reconstructed History" }));
    expect(await screen.findByText("Proposed in MIP104 §14.3")).toBeInTheDocument();
    expect(screen.getByText("Present at Atlas v2 genesis")).toBeInTheDocument();
    expect(screen.getByText(/trace atlas history prior to the current git repo/i)).toBeInTheDocument();
  });

  it("orders by commitSeq, not date, when a severed-era birth carries no date at all", async () => {
    mockLoad.mockResolvedValue([
      entry({ date: "2024-09-02", commitHash: "genesis:bafkreih7", era: "genesis", commitSeq: -20000, summary: "genesis fact" }),
      entry({ date: "", commitHash: "severed:window", era: "severed", commitSeq: -10000, summary: "severed birth" }),
    ]);
    render(<NodeHistory nodeId="n10" />);
    fireEvent.click(await screen.findByRole("button", { name: "View Reconstructed History" }));
    const severed = await screen.findByText("severed birth");
    const genesis = screen.getByText("genesis fact");
    // severed (commitSeq -10000, chronologically LATER) must render before genesis
    // (-20000, earlier) — a naive date-string sort would put the undated severed
    // entry last (empty string sorts smallest), which is chronologically backwards.
    expect(severed.compareDocumentPosition(genesis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("links a reconstructed row to its external source instead of a dead commit link", async () => {
    mockLoad.mockResolvedValue([
      entry({
        date: "2023-11-06", commitHash: "mip:104:14.3", era: "mip", changeType: "added", commitSeq: -29000,
        summary: "Proposed in MIP104 §14.3",
        sourceUrl: "https://github.com/sky-ecosystem/mips/blob/main/MIP104/MIP104.md#1413",
      }),
    ]);
    render(<NodeHistory nodeId="n11" />);
    fireEvent.click(await screen.findByRole("button", { name: "View Reconstructed History" }));
    await screen.findByText("Proposed in MIP104 §14.3");
    const link = screen.getByText("source →").closest("a");
    expect(link).toHaveAttribute("href", "https://github.com/sky-ecosystem/mips/blob/main/MIP104/MIP104.md#1413");
  });

  it('relabels the root html-snapshot "added" row "committed" when an older reconstructed origin exists', async () => {
    mockLoad.mockResolvedValue([
      entry({ date: "2025-05-28", commitHash: "4e931dfda1b2c3d", era: "html", changeType: "added", commitSeq: 1 }),
      entry({
        date: "2024-09-02", commitHash: "genesis:bafkreih7", era: "genesis", changeType: "added",
        commitSeq: -20000, summary: "Present at Atlas v2 genesis",
      }),
    ]);
    render(<NodeHistory nodeId="n12" />);
    fireEvent.click(await screen.findByRole("button", { name: "View Reconstructed History" }));
    await screen.findByText("Present at Atlas v2 genesis");
    expect(screen.getByText("committed")).toBeInTheDocument();
  });

  it('hides the redundant "added" chip on mip/genesis/severed events (the summary already says it)', async () => {
    mockLoad.mockResolvedValue([
      entry({
        date: "2024-09-02", commitHash: "genesis:bafkreih7", era: "genesis", changeType: "added",
        commitSeq: -20000, summary: "Present at Atlas v2 genesis",
      }),
    ]);
    render(<NodeHistory nodeId="n13" />);
    fireEvent.click(await screen.findByRole("button", { name: "View Reconstructed History" }));
    await screen.findByText("Present at Atlas v2 genesis");
    expect(screen.queryByText("added")).not.toBeInTheDocument();
  });

  it("places the toggle right below the migration entry, not at the top", async () => {
    mockLoad.mockResolvedValue([
      entry({ date: "2026-01-01", commitHash: "newer12", commitSeq: 200, summary: "a modern edit" }),
      entry({ date: "2025-11-21", commitHash: "22cc27b", commitSeq: 82, pr: 117, prTitle: "Migrate To Markdown File" }),
      entry({ date: "2025-09-01", commitHash: "html0001", era: "html", commitSeq: 5, summary: "an html-era change" }),
    ]);
    render(<NodeHistory nodeId="n14" />);
    const modern = await screen.findByText("a modern edit");
    const migration = screen.getByText("Migrate To Markdown File");
    const toggle = screen.getByRole("button", { name: "View Reconstructed History" });
    // DOM order: modern edit, then the migration row, then the toggle.
    expect(modern.compareDocumentPosition(migration) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(migration.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("falls back to the top when there's no migration entry for this doc (byte-identical across #117)", async () => {
    mockLoad.mockResolvedValue([
      entry({ date: "2026-01-01", commitHash: "newer12", commitSeq: 200, summary: "a modern edit" }),
      entry({ date: "2025-09-01", commitHash: "html0001", era: "html", commitSeq: 5, summary: "an html-era change" }),
    ]);
    render(<NodeHistory nodeId="n15" />);
    const modern = await screen.findByText("a modern edit");
    const toggle = screen.getByRole("button", { name: "View Reconstructed History" });
    expect(toggle.compareDocumentPosition(modern) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
