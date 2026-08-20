// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

Element.prototype.scrollIntoView = vi.fn();
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import type { ActiveDataRow } from "@/lib/activeDataIndex";

const rows: ActiveDataRow[] = [
  {
    activeDataId: "ad-1",
    activeDataDocNo: "A.1.6.1",
    activeDataTitle: "Spark Loan Registry",
    controllerId: "ctrl-1",
    controllerDocNo: "A.1.6",
    controllerTitle: "Spark Loan Controller",
    agent: "Spark",
    chain: null,
    responsibleParty: {
      name: "Spark Ops",
      id: "rp-1",
      docId: "rp-doc-1",
      resolution: "direct",
      declared: null,
      evidence: [{ docNo: "A.1.6.1", docId: "rp-doc-1", label: "Spark Ops entry" }],
    },
    declaredRP: null,
    facilitator: {
      name: "Spark Facilitator",
      id: "fac-1",
      docId: "fac-doc-1",
      role: "Operational Facilitator",
      evidence: [{ docNo: "A.1.6.2", docId: "fac-doc-1", label: "facilitator entry" }],
    },
    process: "Direct Edit",
    sourceDocNo: "A.1.6.1",
  },
  {
    activeDataId: "ad-2",
    activeDataDocNo: "A.1.7.1",
    activeDataTitle: "Governance Ledger",
    controllerId: null,
    controllerDocNo: null,
    controllerTitle: null,
    agent: null,
    chain: null,
    responsibleParty: null,
    declaredRP: "the DAO Treasury",
    facilitator: null,
    process: "Alignment Conserver Changes",
    sourceDocNo: null,
  },
];

vi.mock("../../lib/docs", () => ({ loadDocs: () => Promise.resolve({}) }));
vi.mock("../../lib/graph", () => ({ loadGraph: () => Promise.resolve({}) }));
vi.mock("@/lib/history", () => ({
  loadHistoryBatch: () =>
    Promise.resolve(
      new Map([["ad-1", [{ date: "2026-05-01", commitHash: "abc", changeType: "modified" }]]]),
    ),
}));
vi.mock("@/lib/activeDataIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/activeDataIndex")>();
  return {
    ...actual,
    buildActiveDataRows: () => rows,
  };
});

import { ActiveDataReport } from "./ActiveDataReport";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("ActiveDataReport", () => {
  it("renders all rows with responsible party, facilitator, process, and last-edited date", async () => {
    render(<ActiveDataReport query="" mode="broad" />);
    expect(await screen.findByText("Spark Loan Registry")).toBeInTheDocument();
    expect(screen.getByText("Governance Ledger")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Spark Ops")).toBeInTheDocument();
    expect(within(table).getByText("Spark Facilitator")).toBeInTheDocument();
    expect(within(table).getByText("Direct Edit")).toBeInTheDocument();
    expect(within(table).getByText("the DAO Treasury")).toBeInTheDocument();
    expect(screen.getByText("2 sections")).toBeInTheDocument();

    // Last-edited date resolved via loadHistoryBatch, async after mount.
    expect(await screen.findByText("2026-05-01")).toBeInTheDocument();
  });

  it("filters by the Scope (agent) pill, toggling active state and narrowing rows", async () => {
    render(<ActiveDataReport query="" mode="broad" />);
    await screen.findByText("Spark Loan Registry");

    const sparkPill = screen.getByRole("button", { name: "Spark" });
    fireEvent.click(sparkPill);

    expect(sparkPill).toHaveAttribute("data-active", "true");
    expect(screen.getByText("Spark Loan Registry")).toBeInTheDocument();
    expect(screen.queryByText("Governance Ledger")).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("agent")).toBe("Spark");

    // Click again to clear the filter.
    fireEvent.click(sparkPill);
    expect(sparkPill).not.toHaveAttribute("data-active");
    expect(screen.getByText("Governance Ledger")).toBeInTheDocument();
  });

  it("filters by the Governance scope pill (agent === null)", async () => {
    render(<ActiveDataReport query="" mode="broad" />);
    await screen.findByText("Spark Loan Registry");

    const govPill = screen.getByRole("button", { name: "Governance" });
    fireEvent.click(govPill);
    expect(screen.getByText("Governance Ledger")).toBeInTheDocument();
    expect(screen.queryByText("Spark Loan Registry")).not.toBeInTheDocument();
  });

  it("filters by the Entity pill (responsible party or facilitator name)", async () => {
    render(<ActiveDataReport query="" mode="broad" />);
    await screen.findByText("Spark Loan Registry");

    const entityPill = screen.getByRole("button", { name: "Spark Facilitator" });
    fireEvent.click(entityPill);
    expect(new URLSearchParams(window.location.search).get("entity")).toBe("Spark Facilitator");
    expect(screen.getByText("Spark Loan Registry")).toBeInTheDocument();
    expect(screen.queryByText("Governance Ledger")).not.toBeInTheDocument();
  });

  it("filters via the text query prop and shows NoRowsMatch for a non-matching query", async () => {
    render(<ActiveDataReport query="treasury" mode="broad" />);
    expect(await screen.findByText("Governance Ledger")).toBeInTheDocument();
    expect(screen.queryByText("Spark Loan Registry")).not.toBeInTheDocument();

    cleanup();
    render(<ActiveDataReport query="zzz-nonexistent" mode="broad" />);
    expect(await screen.findByText(/No rows match/)).toBeInTheDocument();
  });

  it("shows the CSV download controls", async () => {
    render(<ActiveDataReport query="" mode="broad" />);
    await screen.findByText("Spark Loan Registry");
    expect(screen.getByText("Download full report")).toBeInTheDocument();
  });

  it("builds and downloads a CSV when the download button is clicked", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    render(<ActiveDataReport query="" mode="broad" />);
    await screen.findByText("Spark Loan Registry");
    fireEvent.click(screen.getByText("Download full report"));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("builds the filtered CSV when the filtered download button is clicked", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    render(<ActiveDataReport query="spark" mode="broad" />);
    await screen.findByText("Direct Edit");
    fireEvent.click(screen.getByText("Download filtered report"));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});
