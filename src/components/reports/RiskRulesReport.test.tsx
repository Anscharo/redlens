// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { RiskRow, RiskJoin } from "../../lib/riskAssessmentIndex";

Element.prototype.scrollIntoView = vi.fn();
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
URL.createObjectURL = vi.fn(() => "blob:x");

vi.mock("../NodeContent", () => ({
  NodeContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("../../lib/docs", () => ({
  loadAtlas: () =>
    Promise.resolve({
      docs: {},
      byParent: new Map(),
      docNoToId: new Map(),
      atlasCommit: null,
    }),
}));

vi.mock("../../lib/addresses", () => ({
  loadAddresses: () => Promise.resolve({}),
}));

function makeRow(over: Partial<RiskRow["candidate"]>, triageOver: Partial<RiskRow["triage"]> = {}, entryOver: Partial<NonNullable<RiskRow["entry"]>> | null = {}): RiskRow {
  const candidate = {
    taskKey: "u:uuid-1",
    uuid: "uuid-1",
    docNo: "A.3.1.1",
    title: "Debt Ceiling Rule",
    quote: "The debt ceiling shall not exceed the risk capital limit.",
    domains: ["alloc"] as const,
    anchored: true,
    stub: false,
    hasMetrics: true,
    ...over,
  };
  const triage = {
    taskKey: candidate.taskKey,
    quoteHash: "h1",
    model: "gpt-triage",
    inScope: true,
    domains: candidate.domains,
    isRule: true,
    description: "Caps total exposure against risk capital.",
    ...triageOver,
  };
  const entry = entryOver === null
    ? null
    : {
        taskKey: candidate.taskKey,
        uuid: candidate.uuid,
        docNo: candidate.docNo,
        title: candidate.title,
        domains: candidate.domains,
        anchored: true,
        stub: false,
        hasMetrics: true,
        description: triage.description,
        quote: candidate.quote,
        quoteHash: "h1",
        model: "gpt-assess",
        rubricVersion: "rv1",
        preciseness: 4 as const,
        precisenessReasoning: "Names a concrete numeric ceiling.",
        metrics: ["debt ceiling %"],
        enforcement: "strong" as const,
        mechanismUuids: [],
        enforcementReasoning: "Breaching it halts new debt issuance.",
        ...entryOver,
      };
  return { candidate, triage, entry, status: entry ? "fresh" : "unassessed" };
}

const ROW_ALLOC = makeRow({});
const ROW_SC = makeRow({
  taskKey: "u:uuid-2",
  uuid: "uuid-2",
  docNo: "A.1.9.1",
  title: "Emergency Shutdown Trigger",
  quote: "The emergency shutdown may be triggered by governance.",
  domains: ["sc"],
  stub: true,
}, { domains: ["sc"], description: "Governance-triggered shutdown path." }, null);

let mockJoin: RiskJoin = { rows: [ROW_ALLOC, ROW_SC], untriaged: 2, rejected: 1 };

vi.mock("../../lib/riskAssessmentIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/riskAssessmentIndex")>();
  return {
    ...actual,
    loadRiskAssessment: () =>
      Promise.resolve({
        rubricVersion: "rv1",
        atlasCommit: null,
        triageModel: "gpt-triage",
        assessModel: "gpt-assess",
        triage: [],
        assessments: [],
      }),
    joinRisk: () => mockJoin,
  };
});

import { RiskRulesReport } from "./RiskRulesReport";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
  mockJoin = { rows: [ROW_ALLOC, ROW_SC], untriaged: 2, rejected: 1 };
});

describe("RiskRulesReport", () => {
  it("renders one row per candidate with a summary strip", async () => {
    render(<RiskRulesReport query="" mode="broad" onNavigate={() => {}} />);
    await screen.findByText("Debt Ceiling Rule");
    expect(screen.getByText("Emergency Shutdown Trigger")).toBeInTheDocument();
    expect(screen.getByText(/2 Atlas sections match the filter/)).toBeInTheDocument();
    expect(screen.getByText(/awaiting triage/)).toBeInTheDocument();
  });

  it("filters rows via the single-select precision (score) pills", async () => {
    render(<RiskRulesReport query="" mode="broad" onNavigate={() => {}} />);
    await screen.findByText("Debt Ceiling Rule");

    const scorePill = screen.getByRole("button", { name: /^4/ });
    fireEvent.click(scorePill);

    expect(screen.getByText("Debt Ceiling Rule")).toBeInTheDocument();
    expect(screen.queryByText("Emergency Shutdown Trigger")).not.toBeInTheDocument();
    const params = new URLSearchParams(window.location.search);
    expect(params.get("precision")).toBe("4");

    // toggling the same pill again clears the filter
    fireEvent.click(scorePill);
    expect(new URLSearchParams(window.location.search).has("precision")).toBe(false);
  });

  it("filters rows via the domain (multi-select) pills", async () => {
    render(<RiskRulesReport query="" mode="broad" onNavigate={() => {}} />);
    await screen.findByText("Debt Ceiling Rule");

    fireEvent.click(screen.getByRole("button", { name: /Smart Contract Security/ }));

    expect(screen.getByText("Emergency Shutdown Trigger")).toBeInTheDocument();
    expect(screen.queryByText("Debt Ceiling Rule")).not.toBeInTheDocument();
    const params = new URLSearchParams(window.location.search);
    expect(params.get("domain")).toBe("sc");
  });

  it("filters rows via the in-report text query prop", async () => {
    const { container } = render(<RiskRulesReport query="shutdown" mode="broad" onNavigate={() => {}} />);
    await screen.findByText("A.1.9.1");
    expect(container.textContent).toContain("Emergency");
    expect(container.textContent).toContain("Trigger");
    expect(screen.queryByText("Debt Ceiling Rule")).not.toBeInTheDocument();
  });

  it("shows the NoRowsMatch state when nothing matches the query", async () => {
    render(<RiskRulesReport query="zzz-no-match" mode="broad" onNavigate={() => {}} />);
    await screen.findByText(/no.*match/i);
  });

  it("expands a row to show precision/incentives reasoning on click", async () => {
    render(<RiskRulesReport query="" mode="broad" onNavigate={() => {}} />);
    const row = await screen.findByText("Debt Ceiling Rule");
    fireEvent.click(row.closest("tr")!);
    expect(await screen.findByText("Names a concrete numeric ceiling.")).toBeInTheDocument();
    expect(screen.getByText("Breaching it halts new debt issuance.")).toBeInTheDocument();
  });

  it("shows the unassessed placeholder for rows without an entry", async () => {
    render(<RiskRulesReport query="" mode="broad" onNavigate={() => {}} />);
    const row = await screen.findByText("Emergency Shutdown Trigger");
    fireEvent.click(row.closest("tr")!);
    expect(await screen.findByText(/Not yet assessed/)).toBeInTheDocument();
  });

  it("shows CSV download controls once rows load", async () => {
    render(<RiskRulesReport query="" mode="broad" onNavigate={() => {}} />);
    await screen.findByText("Debt Ceiling Rule");
    expect(screen.getByRole("button", { name: "Download full report" })).toBeInTheDocument();
  });

  it("renders no CSV controls when there are zero rows", async () => {
    mockJoin = { rows: [], untriaged: 0, rejected: 0 };
    render(<RiskRulesReport query="" mode="broad" onNavigate={() => {}} />);
    await screen.findByText("Risk Rules Assessment");
    expect(screen.queryByRole("button", { name: "Download full report" })).not.toBeInTheDocument();
  });
});
