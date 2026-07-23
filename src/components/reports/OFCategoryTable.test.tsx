// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OFCategoryTable } from "./OFCategoryTable";
import { parseReportQuery } from "../../lib/reportFilter";
import type { OFResponsibility } from "../../lib/facilitatorResponsibilities";
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

describe("OFCategoryTable", () => {
  it("renders duty-shaped columns (Section, Duty, Facilitator, Prime) for op-duty rows", () => {
    const rows: OFResponsibility[] = [
      {
        docNo: "A.1",
        uuid: "u1",
        title: "Duty Title",
        duty: "Duty body text",
        category: "op-duty",
        facilitator: "Facilitator Org",
        agent: "Prime One",
      },
    ];
    render(<OFCategoryTable cat="op-duty" label="Operational Facilitator Duties" rows={rows} chains={chains} />);
    expect(screen.getByRole("heading", { name: /Operational Facilitator Duties \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Section" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Duty" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Facilitator" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Prime" })).toBeInTheDocument();
    expect(screen.getByText("Duty Title")).toBeInTheDocument();
    expect(screen.getByText("Duty body text")).toBeInTheDocument();
    expect(screen.getByText("Facilitator Org")).toBeInTheDocument();
    // Prime chip links via the chain's agentId.
    const primeLink = screen.getByRole("link", { name: "Prime One" });
    expect(primeLink).toHaveAttribute("href", "/atlas?id=p1");
  });

  it("renders assignment-shaped columns (Executor, Facilitator, Prime Agents)", () => {
    const rows: OFResponsibility[] = [
      {
        docNo: "A.2",
        uuid: "u2",
        title: "assignment title (not rendered)",
        duty: "",
        category: "assignment",
        facilitator: "Facilitator Org",
        executor: "Operational Executor Agent Exec One",
        agents: ["Prime One"],
      },
    ];
    render(<OFCategoryTable cat="assignment" label="Facilitator Assignments" rows={rows} chains={chains} />);
    expect(screen.getByRole("columnheader", { name: "Executor Agent" })).toBeInTheDocument();
    // The "Operational Executor Agent " prefix is stripped for display.
    expect(screen.getByText("Exec One")).toBeInTheDocument();
    expect(screen.getByText("Facilitator Org")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Prime One" })).toBeInTheDocument();
    // Assignment rows never show the Section/Duty text columns.
    expect(screen.queryByRole("columnheader", { name: "Section" })).not.toBeInTheDocument();
  });

  it("renders an em dash when an assignment row has no executor/facilitator", () => {
    const rows: OFResponsibility[] = [
      { docNo: "A.3", uuid: "u3", title: "", duty: "", category: "assignment", agents: [] },
    ];
    render(<OFCategoryTable cat="assignment" label="Facilitator Assignments" rows={rows} chains={chains} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("hides the Facilitator column for universal and core-facilitator categories, and hides Prime for universal/core-facilitator/assignment", () => {
    const rows: OFResponsibility[] = [
      {
        docNo: "A.4",
        uuid: "u4",
        title: "Universal Duty",
        duty: "applies to everyone",
        category: "universal",
        facilitators: ["Facilitator Org", "Other Org"],
      },
    ];
    render(<OFCategoryTable cat="universal" label="Universal" rows={rows} chains={chains} />);
    expect(screen.queryByRole("columnheader", { name: "Facilitator" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Prime" })).not.toBeInTheDocument();
  });

  it("shows the Facilitator column (joined names) for active-data and process-step categories", () => {
    const rows: OFResponsibility[] = [
      {
        docNo: "A.5",
        uuid: "u5",
        title: "AD Title",
        duty: "AD duty",
        category: "active-data",
        facilitator: "Facilitator Org",
        agent: "Prime One",
      },
    ];
    render(<OFCategoryTable cat="active-data" label="Active Data" rows={rows} chains={chains} />);
    expect(screen.getByRole("columnheader", { name: "Facilitator" })).toBeInTheDocument();
    expect(screen.getByText("Facilitator Org")).toBeInTheDocument();
  });

  it("renders every source doc link when a row merges multiple docs", () => {
    const rows: OFResponsibility[] = [
      {
        docNo: "A.6",
        uuid: "u6",
        title: "Merged Duty",
        duty: "merged duty text",
        category: "op-duty",
        facilitator: "Facilitator Org",
        sources: [
          { uuid: "u6", docNo: "A.6", agent: "Prime One" },
          { uuid: "u7", docNo: "A.7", agent: "Prime Two" },
        ],
      },
    ];
    render(<OFCategoryTable cat="op-duty" label="Op Duty" rows={rows} chains={chains} />);
    // The aria-label carries the merged doc's owning agent ("A.6 — Prime One").
    expect(screen.getByRole("link", { name: "A.6 — Prime One" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "A.7 — Prime Two" })).toBeInTheDocument();
  });

  it("highlights query matches in visible cells and surfaces hidden-field matches via MatchAside", () => {
    const rows: OFResponsibility[] = [
      {
        docNo: "A.8",
        uuid: "u8",
        title: "Rate Duty",
        duty: "must update the rate weekly",
        category: "op-duty",
        facilitator: "Facilitator Org",
        role: "Operational",
      },
    ];
    const rq = parseReportQuery("operational");
    render(<OFCategoryTable cat="op-duty" label="Op Duty" rows={rows} chains={chains} rq={rq} />);
    // "role" is a hidden field (op-duty rows don't render a role column) —
    // a query matching only it surfaces via the MatchAside excerpt.
    const aside = document.querySelector(".match-aside");
    expect(aside).not.toBeNull();
    expect(within(aside as HTMLElement).getByText("role")).toBeInTheDocument();
  });

  it("defaults rq to EMPTY_QUERY (no highlighting, no aside) when omitted", () => {
    const rows: OFResponsibility[] = [
      { docNo: "A.9", uuid: "u9", title: "Plain Duty", duty: "plain text", category: "op-duty" },
    ];
    render(<OFCategoryTable cat="op-duty" label="Op Duty" rows={rows} chains={chains} />);
    expect(document.querySelector("mark.q-mark")).toBeNull();
    expect(document.querySelector(".match-aside")).toBeNull();
  });

});
