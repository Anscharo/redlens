// @vitest-environment jsdom
// Smoke + interaction test for the HTML-era history curation page. Mocks the data layer
// (offline case file + auto-resolved baseline + frontier hints) so it runs headless in
// jsdom. The page makes NO live LLM calls — suggestions come from the static proposals file.
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { sampleData, savePicks, auto, proposals, committed, saveSpy } = vi.hoisted(() => ({
  // mutable holders for the offline baseline + frontier hints + committed human decisions
  auto: { current: {} as Record<string, { chosenKey: string; auto: string }> },
  proposals: { current: {} as Record<string, { chosenKey: string; why: string }> },
  committed: { current: {} as Record<string, string> },
  saveSpy: vi.fn(() => Promise.resolve(1)),
  sampleData: {
    meta: { migrationSha: "aaaaaaa", lastHtmlSha: "bbbbbbb", casesByKind: { ambiguous: 1 } },
    commits: [],
    nodes: {
      "n:1": { sha: "newsha1", title: "Reward Payments", doc_no: "A.1", type: "Active Data", content: "paid in USDC", prev: ["ctx:before"], next: ["ctx:after"] },
      "o:1": { sha: "oldsha1", title: "Reward Payments", doc_no: "A.1", type: "Active Data", content: "paid in DAI" },
      "o:2": { sha: "oldsha2", title: "Unrelated Doc", doc_no: "A.9", type: "Core", content: "nothing alike here" },
      "ctx:before": { sha: "newsha1", title: "Preceding Doc", doc_no: "A.0", type: "Core", content: "preceding body text" },
      "ctx:after": { sha: "newsha1", title: "Following Doc", doc_no: "A.2", type: "Core", content: "following body text" },
    },
    cases: [
      { key: "case1", kind: "ambiguous", newerSha: "newsha1", olderSha: "oldsha1", subjectKey: "n:1", autoKey: null, candidates: [{ key: "o:1", score: 0.9 }, { key: "o:2", score: 0.2 }] },
    ],
  },
  savePicks: vi.fn(),
}));

vi.mock("../../lib/historyCuration", () => ({
  loadCuration: () => Promise.resolve(sampleData),
  loadPicks: () => ({}),
  savePicks,
  loadAutoDecisions: () => Promise.resolve(auto.current),
  loadProposals: () => Promise.resolve(proposals.current),
  loadDecisions: () => Promise.resolve(committed.current),
  saveDecisions: saveSpy,
  downloadDecisions: vi.fn(),
}));

import { HistoryCurateReport } from "./HistoryCurateReport";

describe("HistoryCurateReport", () => {
  beforeEach(() => { savePicks.mockClear(); saveSpy.mockClear(); auto.current = {}; proposals.current = {}; committed.current = {}; });
  afterEach(() => cleanup());

  it("renders the first case with its candidates", async () => {
    render(<HistoryCurateReport />);
    expect(await screen.findByText(/Pick its previous version/i)).toBeTruthy();
    expect(screen.getByText("Unrelated Doc")).toBeTruthy(); // a candidate
    expect(screen.getByText(/none — created at this commit/i)).toBeTruthy();
    expect(screen.getByText("90%")).toBeTruthy(); // candidate score
  });

  it("shows a frontier suggestion sourced from the static proposals file", async () => {
    proposals.current = { case1: { chosenKey: "o:1", why: "same doc, DAI→USDC edit" } };
    render(<HistoryCurateReport />);
    expect(await screen.findByText(/LLM suggests/i)).toBeTruthy();
    expect(screen.getByText(/same doc, DAI→USDC edit/)).toBeTruthy();
  });

  it("records a pick when a candidate is clicked", async () => {
    render(<HistoryCurateReport />);
    await screen.findByText(/Pick its previous version/i);
    fireEvent.click(screen.getByText("Unrelated Doc"));
    expect(savePicks).toHaveBeenCalledWith({ case1: "o:2" });
  });

  it("records 'none' when the none option is clicked", async () => {
    render(<HistoryCurateReport />);
    await screen.findByText(/Pick its previous version/i);
    fireEvent.click(screen.getByText(/none — created at this commit/i));
    expect(savePicks).toHaveBeenCalledWith({ case1: "none" });
  });

  it("shows the subject's nearby entries, expandable to full content", async () => {
    render(<HistoryCurateReport />);
    await screen.findByText(/Pick its previous version/i);
    const neighbor = screen.getByText("Following Doc");
    expect(neighbor).toBeTruthy(); // a nearby entry of the subject
    expect(screen.queryByText("following body text")).toBeNull(); // collapsed by default
    fireEvent.click(neighbor);
    expect(screen.getByText("following body text")).toBeTruthy(); // expands to full content
  });

  it("flags a nearby entry as added (+) when it is absent from the other side", async () => {
    render(<HistoryCurateReport />);
    await screen.findByText(/Pick its previous version/i);
    expect(screen.queryAllByText("+")).toHaveLength(0); // no comparison until a side is selected
    fireEvent.click(screen.getByText("Unrelated Doc")); // pick the older candidate (which has no neighbors)
    // the subject's nearby entries don't exist in the older window → marked added
    expect(screen.getAllByText("+").length).toBeGreaterThan(0);
  });

  it("pre-fills the offline auto-resolved baseline and labels its mechanism", async () => {
    auto.current = { case1: { chosenKey: "o:1", auto: "forward-reverse" } };
    render(<HistoryCurateReport />);
    await screen.findByText(/Pick its previous version/i);
    expect(screen.getByText(/1 auto-resolved/)).toBeTruthy(); // header badge
    expect(screen.getByText(/forward \+ reverse agree/i)).toBeTruthy(); // Confirm button provenance
  });

  it("a committed human decision overrides the baseline and drops the auto badge", async () => {
    auto.current = { case1: { chosenKey: "o:2", auto: "llm-90" } }; // baseline said o:2
    committed.current = { case1: "o:1" }; // human committed o:1 instead
    render(<HistoryCurateReport />);
    await screen.findByText(/Pick its previous version/i);
    expect(screen.getByText(/1 \/ 1 decided/)).toBeTruthy(); // committed pick counts as decided
    expect(screen.queryByText(/auto-resolved/i)).toBeNull(); // human overrode → no auto badge
  });

  it("Save to repo writes the committed decisions via saveDecisions", async () => {
    render(<HistoryCurateReport />);
    await screen.findByText(/Pick its previous version/i);
    fireEvent.click(screen.getByText(/save to repo/i));
    expect(saveSpy).toHaveBeenCalledOnce();
    expect(await screen.findByText(/git commit public\/history-decisions\.json/i)).toBeTruthy();
  });
});
