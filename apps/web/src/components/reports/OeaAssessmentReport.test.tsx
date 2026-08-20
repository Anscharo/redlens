// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { OeaRow, OeaReportArtifact } from "@/lib/oeaReport";

Element.prototype.scrollIntoView = vi.fn();
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
URL.createObjectURL = vi.fn(() => "blob:x");

function makeRow(over: Partial<OeaRow["task"]> = {}, entryOver: Partial<NonNullable<OeaRow["entry"]>> | null = {}): OeaRow {
  const task = {
    taskKey: "t:1",
    uuid: "uuid-1",
    docNo: "A.1.1",
    title: "Publish price feed",
    assessedText: "The facilitator must publish the price feed daily.",
    quoted: true,
    category: "op-duty" as const,
    sources: ["facilitator" as const],
    agents: ["Sky Base"],
    ...over,
  };
  const entry = entryOver === null
    ? null
    : {
        taskKey: task.taskKey,
        uuid: task.uuid,
        docNo: task.docNo,
        title: task.title,
        category: task.category,
        sources: task.sources,
        agents: task.agents,
        assessedText: task.assessedText,
        quoted: true,
        quoteHash: "abc",
        model: "gpt-test",
        rubricVersion: "rv1",
        precision: { rating: "strong" as const, elements: { actor: "present", trigger: "present", action: "present", timeBound: "present", completion: "present", discretion: "absent" } as const, reasoning: "Clear precision reasoning." },
        incentives: { rating: "mid" as const, mechanismUuids: [], reasoning: "Some incentives reasoning." },
        ...entryOver,
      };
  return { task, entry, status: entry ? "fresh" : "unassessed" };
}

function makeReport(rows: OeaRow[]): OeaReportArtifact {
  return {
    atlasCommit: null,
    rubricVersion: "rv1",
    model: "gpt-test",
    generatedAt: null,
    summary: { precision: { weak: 0, mid: 0, strong: 0 }, incentives: { weak: 0, mid: 0, strong: 0 }, stale: 0, unassessed: 0 },
    rows,
    mechanisms: {},
  };
}

const ROW_STRONG = makeRow();
const ROW_ASSIGNMENT = makeRow({
  taskKey: "t:2",
  uuid: "uuid-2",
  docNo: "A.2.1",
  title: "Appoint successor",
  assessedText: "The role holder is appointed by governance vote.",
  category: "assignment",
  agents: ["Endgame Edge"],
}, { precision: { rating: "weak", elements: { actor: "present", trigger: "absent", action: "present", timeBound: "absent", completion: "absent", discretion: "absent" }, reasoning: "Weak precision." }, incentives: { rating: "weak", mechanismUuids: [], reasoning: "No incentives." } });
const ROW_UNASSESSED = makeRow({
  taskKey: "t:3",
  uuid: "uuid-3",
  docNo: "A.1.2",
  title: "Rotate signer keys",
  assessedText: "The facilitator rotates signer keys quarterly.",
  category: "op-duty",
  agents: ["Sky Base"],
}, null);

let mockRows: OeaRow[] = [ROW_STRONG, ROW_ASSIGNMENT, ROW_UNASSESSED];

vi.mock("../../lib/oeaReportLoad", () => ({
  loadOeaReport: () => Promise.resolve(makeReport(mockRows)),
}));

const trackMock = vi.fn();
vi.mock("../../lib/analytics", () => ({ track: (...args: unknown[]) => trackMock(...args) }));

import { OeaAssessmentReport } from "./OeaAssessmentReport";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
  mockRows = [ROW_STRONG, ROW_ASSIGNMENT, ROW_UNASSESSED];
  trackMock.mockClear();
});

describe("OeaAssessmentReport", () => {
  // ReportShell holds report_view until the artifact lands, then fires it with
  // the LOADED counts — a zeroed row_count here would mean the shell captured
  // the pre-load props.
  it("fires report_view once, with the loaded row count and rubric version", async () => {
    render(<OeaAssessmentReport query="" mode="broad" />);
    await screen.findByText("Publish price feed");
    const views = trackMock.mock.calls.filter(([e]) => e === "report_view");
    expect(views).toEqual([
      ["report_view", { report: "oea-assessment", row_count: 3, stale_count: 0, unassessed_count: 0, rubric_version: "rv1" }],
    ]);
  });

  it("renders rows grouped by category with a summary strip", async () => {
    render(<OeaAssessmentReport query="" mode="broad" />);
    await screen.findByText("Publish price feed");
    expect(screen.getByText("Appoint successor")).toBeInTheDocument();
    expect(screen.getByText("Rotate signer keys")).toBeInTheDocument();
    // summary strip shows total task count
    expect(screen.getByText(/3 tasks/)).toBeInTheDocument();
  });

  it("filters rows via the category pills", async () => {
    render(<OeaAssessmentReport query="" mode="broad" />);
    await screen.findByText("Publish price feed");

    fireEvent.click(screen.getByRole("button", { name: "assignment" }));

    expect(screen.getByText("Appoint successor")).toBeInTheDocument();
    expect(screen.queryByText("Publish price feed")).not.toBeInTheDocument();
    const params = new URLSearchParams(window.location.search);
    expect(params.get("cat")).toBe("assignment");
  });

  it("filters rows via the in-report text query prop", async () => {
    const { container } = render(<OeaAssessmentReport query="signer" mode="broad" />);
    await screen.findByText(/signer/);
    expect(container.textContent).toContain("Rotate");
    expect(screen.queryByText("Publish price feed")).not.toBeInTheDocument();
    expect(screen.queryByText("Appoint successor")).not.toBeInTheDocument();
  });

  it("shows the NoRowsMatch state when nothing matches the query", async () => {
    render(<OeaAssessmentReport query="zzz-no-match" mode="broad" />);
    await screen.findByText(/no.*match/i);
  });

  it("expands a row to show precision/incentives reasoning on click", async () => {
    render(<OeaAssessmentReport query="" mode="broad" />);
    const title = await screen.findByText("Publish price feed");
    const expandBtn = screen.getByRole("button", { name: /expand assessment reasoning for publish price feed/i });
    fireEvent.click(expandBtn);
    expect(await screen.findByText("Clear precision reasoning.")).toBeInTheDocument();
    expect(screen.getByText("Some incentives reasoning.")).toBeInTheDocument();
    // toggling again collapses
    fireEvent.click(screen.getByRole("button", { name: /collapse assessment reasoning for publish price feed/i }));
    expect(screen.queryByText("Clear precision reasoning.")).not.toBeInTheDocument();
    expect(title).toBeInTheDocument();
  });

  it("shows the unassessed placeholder for rows without an entry", async () => {
    render(<OeaAssessmentReport query="" mode="broad" />);
    await screen.findByText("Rotate signer keys");
    fireEvent.click(screen.getByRole("button", { name: /expand assessment reasoning for rotate signer keys/i }));
    expect(await screen.findByText(/not yet assessed/i)).toBeInTheDocument();
  });

  it("shows the CSV download controls once rows load", async () => {
    render(<OeaAssessmentReport query="" mode="broad" />);
    await screen.findByText("Publish price feed");
    expect(screen.getByRole("button", { name: "Download full report" })).toBeInTheDocument();
  });

  it("renders nothing (no CSV controls) when there are zero rows", async () => {
    mockRows = [];
    render(<OeaAssessmentReport query="" mode="broad" />);
    await screen.findByText("OEA Task Assessment");
    expect(screen.queryByRole("button", { name: "Download full report" })).not.toBeInTheDocument();
  });
});
