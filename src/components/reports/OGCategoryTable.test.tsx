// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OGCategoryTable } from "./OGCategoryTable";
import { parseReportQuery } from "../../lib/reportFilter";
import type { OGResponsibility } from "../../lib/govopsResponsibilities";
import type { Chain } from "../../lib/reportChains";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => cleanup());

const chain: Chain = {
  agentId: "p1",
  executorName: "Exec One",
  executorId: "e1",
  govopsName: "GovOps Org",
  govopsId: "g1",
  facilitatorName: "Facilitator Org",
  facilitatorId: "f1",
};
const chains = new Map<string, Chain>([["Prime One", chain]]);

describe("OGCategoryTable", () => {
  it("renders base duty columns (Section, Duty) with no GovOps/Prime column for definitions", () => {
    const rows: OGResponsibility[] = [
      { docNo: "A.5", uuid: "u5", title: "What GovOps Is", duty: "role definition text", category: "definition" },
    ];
    render(<OGCategoryTable cat="definition" label="Definitions" rows={rows} chains={chains} />);
    expect(screen.getByRole("heading", { name: /Definitions \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Section" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Duty" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "GovOps" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Prime" })).not.toBeInTheDocument();
    expect(screen.getByText("What GovOps Is")).toBeInTheDocument();
    expect(screen.getByText("role definition text")).toBeInTheDocument();
  });

  it("renders assignment-shaped columns (Executor, GovOps, Prime Agents)", () => {
    const rows: OGResponsibility[] = [
      {
        docNo: "A.2",
        uuid: "u2",
        title: "assignment title (not rendered)",
        duty: "",
        category: "assignment",
        govops: "GovOps Org",
        executor: "Operational Executor Agent Exec One",
        agents: ["Prime One"],
      },
    ];
    render(<OGCategoryTable cat="assignment" label="GovOps Assignments" rows={rows} chains={chains} />);
    expect(screen.getByRole("columnheader", { name: "Executor Agent" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "GovOps" })).toBeInTheDocument();
    // The "Operational Executor Agent " prefix is stripped for display.
    expect(screen.getByText("Exec One")).toBeInTheDocument();
    expect(screen.getByText("GovOps Org")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Prime One" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Section" })).not.toBeInTheDocument();
  });

  it("renders an em dash when an assignment row has no executor/govops", () => {
    const rows: OGResponsibility[] = [
      { docNo: "A.3", uuid: "u3", title: "", duty: "", category: "assignment", agents: [] },
    ];
    render(<OGCategoryTable cat="assignment" label="GovOps Assignments" rows={rows} chains={chains} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("shows GovOps + Prime columns for op-duty rows (both AgentChips branches: agent list and single agent)", () => {
    const rows: OGResponsibility[] = [
      {
        docNo: "A.1",
        uuid: "u1",
        title: "Duty A",
        duty: "must do X",
        category: "op-duty",
        govops: "GovOps Org",
        agents: ["Prime One"],
      },
    ];
    render(<OGCategoryTable cat="op-duty" label="Op Duty" rows={rows} chains={chains} />);
    // op-duty shows Prime via the (op-duty || core-duty) branch, not GovOps
    // as a text column (that's active-data/process-step only).
    expect(screen.queryByRole("columnheader", { name: "GovOps" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Prime" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Prime One" })).toBeInTheDocument();
  });

  // Behavior change (approved 2026-08-12): the Prime chip source is now the
  // same unified fallback the Facilitator table and govopsRowsToCSV use, so a
  // duty row that carries only a single `agent` (no `agents` array) shows its
  // Prime chip instead of an empty cell. Data-neutral on the current
  // derivation — op-duty/core-duty rows only ever carry `agents` today — but
  // the table and the CSV can no longer disagree.
  it("shows the Prime chip for an op-duty row carrying a single `agent` (unified fallback)", () => {
    const rows: OGResponsibility[] = [
      {
        docNo: "A.1b",
        uuid: "u1b",
        title: "Single-agent Duty",
        duty: "must do Y",
        category: "op-duty",
        govops: "GovOps Org",
        agent: "Prime One",
      },
    ];
    render(<OGCategoryTable cat="op-duty" label="Op Duty" rows={rows} chains={chains} />);
    expect(screen.getByRole("columnheader", { name: "Prime" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Prime One" })).toBeInTheDocument();
  });

  it("shows both GovOps and Prime columns for active-data rows (single-agent AgentChips branch)", () => {
    const rows: OGResponsibility[] = [
      {
        docNo: "A.4",
        uuid: "u4",
        title: "AD Title",
        duty: "AD duty",
        category: "active-data",
        govops: "GovOps Org",
        agent: "Prime One",
      },
    ];
    render(<OGCategoryTable cat="active-data" label="Active Data" rows={rows} chains={chains} />);
    expect(screen.getByRole("columnheader", { name: "GovOps" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Prime" })).toBeInTheDocument();
    expect(screen.getByText("GovOps Org")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Prime One" })).toBeInTheDocument();
  });

  it("renders every source doc link when a row merges multiple docs", () => {
    const rows: OGResponsibility[] = [
      {
        docNo: "A.6",
        uuid: "u6",
        title: "Merged Duty",
        duty: "merged duty text",
        category: "core-duty",
        govops: "GovOps Org",
        sources: [
          { uuid: "u6", docNo: "A.6", agent: "Prime One" },
          { uuid: "u7", docNo: "A.7", agent: "Prime Two" },
        ],
      },
    ];
    render(<OGCategoryTable cat="core-duty" label="Core Duty" rows={rows} chains={chains} />);
    expect(screen.getByRole("link", { name: "A.6 — Prime One" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "A.7 — Prime Two" })).toBeInTheDocument();
  });

  it("highlights query matches in visible cells and surfaces hidden-field matches via MatchAside", () => {
    const rows: OGResponsibility[] = [
      {
        docNo: "A.8",
        uuid: "u8",
        title: "Rate Duty",
        duty: "must update the rate weekly",
        category: "op-duty",
        govops: "GovOps Org",
        role: "Operational",
      },
    ];
    const rq = parseReportQuery("operational");
    render(<OGCategoryTable cat="op-duty" label="Op Duty" rows={rows} chains={chains} rq={rq} />);
    const aside = document.querySelector(".match-aside");
    expect(aside).not.toBeNull();
    expect(within(aside as HTMLElement).getByText("role")).toBeInTheDocument();
  });

  it("defaults rq to EMPTY_QUERY (no highlighting, no aside) when omitted", () => {
    const rows: OGResponsibility[] = [
      { docNo: "A.9", uuid: "u9", title: "Plain Duty", duty: "plain text", category: "op-duty" },
    ];
    render(<OGCategoryTable cat="op-duty" label="Op Duty" rows={rows} chains={chains} />);
    expect(document.querySelector("mark.q-mark")).toBeNull();
    expect(document.querySelector(".match-aside")).toBeNull();
  });
});
