// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { AtlasNode } from "../../types";
import type { RiskRow } from "../../lib/riskAssessmentIndex";
import { EMPTY_QUERY } from "../../lib/reportFilter";

vi.mock("../NodeContent", () => ({
  NodeContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

import { RiskTable, ScorePill } from "./RiskRulesTable";

afterEach(cleanup);

const docs: Record<string, AtlasNode> = {
  "mech-uuid-1": { id: "mech-uuid-1", doc_no: "A.9", title: "Slashing Mechanism", type: "Core", depth: 1, parentId: null, content: "", order: 1, addressRefs: [] },
};

const ROW_ASSESSED: RiskRow = {
  candidate: {
    taskKey: "u:uuid-1",
    uuid: "uuid-1",
    docNo: "A.3.1.1",
    title: "Debt Ceiling Rule",
    quote: "The debt ceiling shall not exceed the risk capital limit.",
    domains: ["alloc"],
    anchored: true,
    stub: false,
    hasMetrics: true,
  },
  triage: {
    taskKey: "u:uuid-1",
    quoteHash: "h1",
    model: "gpt-triage",
    inScope: true,
    domains: ["alloc"],
    isRule: true,
    description: "Caps total exposure against risk capital.",
  },
  entry: {
    taskKey: "u:uuid-1",
    uuid: "uuid-1",
    docNo: "A.3.1.1",
    title: "Debt Ceiling Rule",
    domains: ["alloc"],
    anchored: true,
    stub: false,
    hasMetrics: true,
    description: "Caps total exposure against risk capital.",
    quote: "The debt ceiling shall not exceed the risk capital limit.",
    quoteHash: "h1",
    model: "gpt-assess",
    rubricVersion: "rv1",
    preciseness: 4,
    precisenessReasoning: "Names a concrete numeric ceiling.",
    metrics: ["debt ceiling %"],
    enforcement: "strong",
    mechanismUuids: ["mech-uuid-1"],
    enforcementReasoning: "Breaching it halts new debt issuance.",
  },
  status: "stale",
};

const ROW_UNASSESSED: RiskRow = {
  candidate: {
    taskKey: "u:uuid-2",
    uuid: "uuid-2",
    docNo: "A.1.9.1",
    title: "Emergency Shutdown Trigger",
    quote: "The emergency shutdown may be triggered by governance.",
    domains: ["sc"],
    anchored: true,
    stub: true,
  },
  triage: {
    taskKey: "u:uuid-2",
    quoteHash: "h2",
    model: "gpt-triage",
    inScope: true,
    domains: ["sc"],
    isRule: true,
    description: "Governance-triggered shutdown path.",
  },
  entry: null,
  status: "unassessed",
};

describe("RiskTable", () => {
  it("renders one row per candidate with doc no, title, and domain pills", () => {
    render(<RiskTable rows={[ROW_ASSESSED, ROW_UNASSESSED]} docs={docs} expandedKey={null} onToggle={() => {}} onNavigate={() => {}} />);
    expect(screen.getByText("A.3.1.1")).toBeInTheDocument();
    expect(screen.getByText("Debt Ceiling Rule")).toBeInTheDocument();
    expect(screen.getByText("Allocation Risk")).toBeInTheDocument();
    expect(screen.getByText("A.1.9.1")).toBeInTheDocument();
    expect(screen.getByText("Emergency Shutdown Trigger")).toBeInTheDocument();
    expect(screen.getByText("Smart Contract Security")).toBeInTheDocument();
    expect(screen.getByText("[stub]")).toBeInTheDocument();
    expect(screen.getByText("4/5")).toBeInTheDocument();
    expect(screen.getByText("strong")).toBeInTheDocument();
  });

  it("shows a stale badge for stale rows and an unassessed badge for unassessed rows", () => {
    render(<RiskTable rows={[ROW_ASSESSED, ROW_UNASSESSED]} docs={docs} expandedKey={null} onToggle={() => {}} onNavigate={() => {}} />);
    expect(screen.getByText("stale")).toHaveClass("badge-red");
    expect(screen.getByText("unassessed")).toHaveClass("badge-muted");
  });

  it("clicking anywhere on the row calls onToggle", () => {
    const onToggle = vi.fn();
    render(<RiskTable rows={[ROW_ASSESSED]} docs={docs} expandedKey={null} onToggle={onToggle} onNavigate={() => {}} />);
    fireEvent.click(screen.getByText("Debt Ceiling Rule").closest("tr")!);
    expect(onToggle).toHaveBeenCalledWith(ROW_ASSESSED);
  });

  it("clicking the doc-no link does not trigger onToggle (stopPropagation)", () => {
    const onToggle = vi.fn();
    render(<RiskTable rows={[ROW_ASSESSED]} docs={docs} expandedKey={null} onToggle={onToggle} onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole("link", { name: "A.3.1.1" }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("clicking the expand chevron calls onToggle and stops propagation", () => {
    const onToggle = vi.fn();
    render(<RiskTable rows={[ROW_ASSESSED]} docs={docs} expandedKey={null} onToggle={onToggle} onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /expand assessment reasoning for debt ceiling rule/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(ROW_ASSESSED);
  });

  it("renders the expanded body with source paragraph, reasoning, metrics, and mechanism link", () => {
    render(<RiskTable rows={[ROW_ASSESSED]} docs={docs} expandedKey="u:uuid-1" onToggle={() => {}} onNavigate={() => {}} />);
    expect(screen.getByText("Source paragraph")).toBeInTheDocument();
    expect(screen.getByText("The debt ceiling shall not exceed the risk capital limit.")).toBeInTheDocument();
    expect(screen.getByText("Names a concrete numeric ceiling.")).toBeInTheDocument();
    expect(screen.getByText("debt ceiling %")).toBeInTheDocument();
    expect(screen.getByText("Breaching it halts new debt issuance.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Slashing Mechanism/ })).toBeInTheDocument();
    expect(screen.getByText(/STALE/)).toBeInTheDocument();
  });

  it("renders the unassessed placeholder in the expanded body when there is no entry", () => {
    render(<RiskTable rows={[ROW_UNASSESSED]} docs={docs} expandedKey="u:uuid-2" onToggle={() => {}} onNavigate={() => {}} />);
    expect(screen.getByText(/Not yet assessed/)).toBeInTheDocument();
    expect(screen.getByText(/pnpm risk:assess/)).toBeInTheDocument();
  });

  it("paginates via the show-more button beyond a page", () => {
    const manyRows: RiskRow[] = Array.from({ length: 105 }, (_, i) => ({
      candidate: {
        taskKey: `u:uuid-${i}`,
        uuid: `uuid-${i}`,
        docNo: `A.3.1.${i}`,
        title: `Rule ${i}`,
        quote: `Quote ${i}`,
        domains: ["alloc"] as const,
        anchored: true,
        stub: false,
        hasMetrics: false,
      },
      triage: {
        taskKey: `u:uuid-${i}`,
        quoteHash: `h${i}`,
        model: "gpt-triage",
        inScope: true,
        domains: ["alloc"] as const,
        isRule: true,
        description: `Desc ${i}`,
      },
      entry: null,
      status: "unassessed" as const,
    }));
    render(<RiskTable rows={manyRows} docs={docs} expandedKey={null} onToggle={() => {}} onNavigate={() => {}} />);
    expect(screen.getByText("Rule 0")).toBeInTheDocument();
    expect(screen.queryByText("Rule 104")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show 5 more/i }));
    expect(screen.getByText("Rule 104")).toBeInTheDocument();
  });

  it("ScorePill renders a dash for null and a fraction for a score", () => {
    render(<ScorePill s={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    cleanup();
    render(<ScorePill s={3} />);
    expect(screen.getByText("3/5")).toBeInTheDocument();
  });

  it("uses EMPTY_QUERY by default so Highlight renders plain text", () => {
    render(<RiskTable rows={[ROW_ASSESSED]} docs={docs} expandedKey={null} onToggle={() => {}} onNavigate={() => {}} rq={EMPTY_QUERY} />);
    expect(screen.getByText("Debt Ceiling Rule")).toBeInTheDocument();
  });

  it("falls back to the raw UUID for an unresolved mechanism, and to the candidate's own domains when triage has none", () => {
    const row: RiskRow = {
      ...ROW_ASSESSED,
      triage: { ...ROW_ASSESSED.triage, domains: [] },
      entry: { ...ROW_ASSESSED.entry!, mechanismUuids: ["unknown-mech-uuid"] },
    };
    render(<RiskTable rows={[row]} docs={docs} expandedKey="u:uuid-1" onToggle={() => {}} onNavigate={() => {}} />);
    // DomainPills falls back to candidate.domains ("alloc") when triage.domains is empty.
    expect(screen.getByText("Allocation Risk")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /unknown-/ })).toBeInTheDocument();
  });
});
