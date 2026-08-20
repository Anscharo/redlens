// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OeaTable, RatingPill } from "./OeaAssessmentTable";
import { EMPTY_QUERY } from "@/lib/reportFilter";
import type { OeaRow } from "@/lib/oeaReport";

afterEach(cleanup);

const ROW_ASSESSED: OeaRow = {
  task: {
    taskKey: "t:1",
    uuid: "uuid-1",
    docNo: "A.1.1",
    title: "Publish price feed",
    assessedText: "The facilitator must publish the price feed daily.",
    quoted: true,
    category: "op-duty",
    sources: ["facilitator"],
    agents: ["Sky Base"],
    automated: true,
  },
  entry: {
    taskKey: "t:1",
    uuid: "uuid-1",
    docNo: "A.1.1",
    title: "Publish price feed",
    category: "op-duty",
    sources: ["facilitator"],
    agents: ["Sky Base"],
    assessedText: "The facilitator must publish the price feed daily.",
    quoted: true,
    quoteHash: "abc",
    model: "gpt-test",
    rubricVersion: "rv1",
    precision: {
      rating: "strong",
      elements: { actor: "present", trigger: "present", action: "present", timeBound: "partial", completion: "present", discretion: "absent" },
      reasoning: "Precisely worded duty.",
    },
    incentives: {
      rating: "mid",
      mechanismUuids: ["mech-uuid-1"],
      reasoning: "Some incentive reasoning.",
    },
  },
  status: "stale",
};

const ROW_UNASSESSED: OeaRow = {
  task: {
    taskKey: "t:2",
    uuid: "uuid-2",
    docNo: "A.1.2",
    title: "Rotate signer keys",
    assessedText: "The facilitator rotates signer keys quarterly.",
    quoted: true,
    category: "op-duty",
    sources: ["facilitator"],
  },
  entry: null,
  status: "unassessed",
};

const mechanisms = { "mech-uuid-1": { uuid: "mech-uuid-1", title: "Slashing Mechanism", docNo: "A.9" } };

describe("OeaTable", () => {
  it("renders one row per task with doc no, title, and rating pills", () => {
    render(
      <OeaTable label="Operational Duties" rows={[ROW_ASSESSED, ROW_UNASSESSED]} mechanisms={mechanisms}
        expandedKey={null} onToggle={() => {}} />,
    );
    expect(screen.getByText("Operational Duties")).toBeInTheDocument();
    expect(screen.getByText("(2)")).toBeInTheDocument();
    expect(screen.getByText("A.1.1")).toBeInTheDocument();
    expect(screen.getByText("Publish price feed")).toBeInTheDocument();
    expect(screen.getByText("A.1.2")).toBeInTheDocument();
    expect(screen.getByText("Rotate signer keys")).toBeInTheDocument();
    // automated marker only on the first task
    expect(screen.getByText("[automated]")).toBeInTheDocument();
    // assessed row shows its ratings; unassessed shows the dash placeholder
    expect(screen.getByText("strong")).toBeInTheDocument();
    expect(screen.getByText("mid")).toBeInTheDocument();
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("shows a stale badge for stale rows, none for fresh", () => {
    render(
      <OeaTable label="Operational Duties" rows={[ROW_ASSESSED]} mechanisms={mechanisms}
        expandedKey={null} onToggle={() => {}} />,
    );
    expect(screen.getByText("stale")).toHaveClass("badge-red");
  });

  it("shows an unassessed badge for unassessed rows", () => {
    render(
      <OeaTable label="Operational Duties" rows={[ROW_UNASSESSED]} mechanisms={mechanisms}
        expandedKey={null} onToggle={() => {}} />,
    );
    expect(screen.getByText("unassessed")).toHaveClass("badge-muted");
  });

  it("calls onToggle with the row when the expand chevron is clicked", () => {
    const onToggle = vi.fn();
    render(
      <OeaTable label="Operational Duties" rows={[ROW_ASSESSED]} mechanisms={mechanisms}
        expandedKey={null} onToggle={onToggle} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /expand assessment reasoning for publish price feed/i }));
    expect(onToggle).toHaveBeenCalledWith(ROW_ASSESSED);
  });

  it("renders the expanded body with precision/incentives reasoning and mechanism link when expandedKey matches", () => {
    render(
      <OeaTable label="Operational Duties" rows={[ROW_ASSESSED]} mechanisms={mechanisms}
        expandedKey="t:1" onToggle={() => {}} />,
    );
    expect(screen.getByText("Precisely worded duty.")).toBeInTheDocument();
    expect(screen.getByText("Some incentive reasoning.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Slashing Mechanism/ })).toBeInTheDocument();
    expect(screen.getByText(/STALE/)).toBeInTheDocument();
    expect(screen.getByText(/assessed by gpt-test/)).toBeInTheDocument();
  });

  it("renders the unassessed placeholder in the expanded body when there is no entry", () => {
    render(
      <OeaTable label="Operational Duties" rows={[ROW_UNASSESSED]} mechanisms={mechanisms}
        expandedKey="t:2" onToggle={() => {}} />,
    );
    expect(screen.getByText(/Not yet assessed/)).toBeInTheDocument();
    expect(screen.getByText(/pnpm oea:assess/)).toBeInTheDocument();
  });

  it("shows the show-more button and paginates once more than a page of rows exist", () => {
    const manyRows: OeaRow[] = Array.from({ length: 120 }, (_, i) => ({
      task: {
        taskKey: `t:${i}`,
        uuid: `uuid-${i}`,
        docNo: `A.1.${i}`,
        title: `Task ${i}`,
        assessedText: `Text ${i}`,
        quoted: true,
        category: "op-duty",
        sources: ["facilitator"],
      },
      entry: null,
      status: "unassessed",
    }));
    render(
      <OeaTable label="Operational Duties" rows={manyRows} mechanisms={mechanisms}
        expandedKey={null} onToggle={() => {}} />,
    );
    expect(screen.getByText("Task 0")).toBeInTheDocument();
    expect(screen.queryByText("Task 119")).not.toBeInTheDocument();
    const showMore = screen.getByRole("button", { name: /show 20 more/i });
    fireEvent.click(showMore);
    expect(screen.getByText("Task 119")).toBeInTheDocument();
  });

  it("RatingPill renders a dash for null and a labeled pill for a rating", () => {
    const { container: nullContainer } = render(<RatingPill r={null} />);
    expect(within(nullContainer).getByText("—")).toBeInTheDocument();
    cleanup();
    render(<RatingPill r="weak" />);
    expect(screen.getByText("weak")).toBeInTheDocument();
  });

  it("uses EMPTY_QUERY by default so Highlight renders plain text", () => {
    render(
      <OeaTable label="Operational Duties" rows={[ROW_ASSESSED]} mechanisms={mechanisms}
        expandedKey={null} onToggle={() => {}} rq={EMPTY_QUERY} />,
    );
    expect(screen.getByText("Publish price feed")).toBeInTheDocument();
  });

  it("shows the representative-snippet caveat when the entry is not a verbatim quote, and falls back to the raw UUID for an unresolved mechanism", () => {
    const row: OeaRow = {
      ...ROW_ASSESSED,
      entry: {
        ...ROW_ASSESSED.entry!,
        quoted: false,
        incentives: { ...ROW_ASSESSED.entry!.incentives, mechanismUuids: ["unknown-mech-uuid"] },
      },
    };
    render(
      <OeaTable label="Operational Duties" rows={[row]} mechanisms={mechanisms}
        expandedKey="t:1" onToggle={() => {}} />,
    );
    expect(screen.getByText(/representative snippet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /unknown-/ })).toBeInTheDocument();
  });
});
