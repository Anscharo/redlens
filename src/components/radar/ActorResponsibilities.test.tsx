// @vitest-environment jsdom

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ActorResponsibilities } from "./ActorResponsibilities";
import type { ActiveDataRow } from "../../lib/activeDataIndex";

afterEach(cleanup);

function row(overrides: Partial<ActiveDataRow> = {}): ActiveDataRow {
  return {
    activeDataId: "ad-1",
    activeDataDocNo: "A.0.6.1",
    activeDataTitle: "Some Active Data",
    controllerId: null,
    controllerDocNo: null,
    controllerTitle: null,
    agent: null,
    chain: null,
    responsibleParty: null,
    declaredRP: null,
    facilitator: null,
    process: "Direct Edit",
    sourceDocNo: null,
    ...overrides,
  };
}

describe("ActorResponsibilities", () => {
  it("renders the table headers", () => {
    render(<ActorResponsibilities rows={[]} />);
    expect(screen.getByText("Active Data")).toBeInTheDocument();
    expect(screen.getByText("Controller")).toBeInTheDocument();
    expect(screen.getByText("Responsible Party")).toBeInTheDocument();
    expect(screen.getByText("Facilitator")).toBeInTheDocument();
    expect(screen.getByText("Process")).toBeInTheDocument();
  });

  it("renders row title/docNo and a dash for null controller/responsibleParty/facilitator", () => {
    render(<ActorResponsibilities rows={[row()]} />);
    expect(screen.getByText("Some Active Data")).toBeInTheDocument();
    expect(screen.getByText("A.0.6.1")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("none")).toBeInTheDocument();
  });

  it("renders controllerDocNo link, responsibleParty name, facilitator name when set", () => {
    const r = row({
      controllerId: "ctrl-1",
      controllerDocNo: "A.1.2.3",
      responsibleParty: {
        id: "rp-1",
        name: "Responsible Co",
        docId: null,
        resolution: "direct",
        declared: null,
        evidence: [],
      },
      facilitator: {
        id: "fac-1",
        name: "Facil Co",
        docId: null,
        role: "Operational Facilitator",
        evidence: [],
      },
    });
    render(<ActorResponsibilities rows={[r]} />);
    expect(screen.getByRole("link", { name: "A.1.2.3" })).toBeInTheDocument();
    expect(screen.getByText("Responsible Co")).toBeInTheDocument();
    expect(screen.getByText("Facil Co")).toBeInTheDocument();
  });

  it("renders AC for Alignment Conserver Changes process and Direct otherwise", () => {
    const acRow = row({ activeDataId: "ad-ac", process: "Alignment Conserver Changes" });
    const directRow = row({ activeDataId: "ad-direct", process: "Direct Edit" });
    render(<ActorResponsibilities rows={[acRow, directRow]} />);
    expect(screen.getByText("AC")).toBeInTheDocument();
    expect(screen.getByText("Direct")).toBeInTheDocument();
  });

  it("renders the View all in Active Data Report link", () => {
    render(<ActorResponsibilities rows={[]} />);
    const link = screen.getByRole("link", { name: /View all in Active Data Report/ });
    expect(link).toHaveAttribute("href", "/reports/active-data");
  });
});
