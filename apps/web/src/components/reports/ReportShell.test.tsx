// @vitest-environment jsdom
// ReportShell owns the chrome every /reports/* page shares — including the
// `report_view` event, which used to be per-page (and was missing on most of
// them). These tests pin the once-per-mount firing, the ready gate, and the
// loading / no-rows states.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const track = vi.fn();
vi.mock("../../lib/analytics", () => ({ track: (...args: unknown[]) => track(...args) }));

const { ReportShell } = await import("./ReportShell");

afterEach(() => {
  cleanup();
  track.mockClear();
  document.title = "";
});

describe("ReportShell", () => {
  it("renders the standard chrome and derives the document title from the heading", () => {
    render(
      <ReportShell report="active-data" title="Active Data Index" query="" count="2 sections">
        <p>body</p>
      </ReportShell>,
    );
    expect(screen.getByRole("heading", { name: "Active Data Index", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("report")).toBeInTheDocument();
    expect(screen.getByText("2 sections")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(document.title).toBe("Active Data Index: Sky Atlas by Redline");
  });

  it("fires report_view once, with the page's extra properties", () => {
    const { rerender } = render(
      <ReportShell report="rewards" title="Rewards" query="" viewProps={{ row_count: 12 }}>
        <p>body</p>
      </ReportShell>,
    );
    rerender(
      <ReportShell report="rewards" title="Rewards" query="" viewProps={{ row_count: 12 }}>
        <p>body again</p>
      </ReportShell>,
    );
    expect(track.mock.calls.filter(([e]) => e === "report_view")).toEqual([
      ["report_view", { report: "rewards", row_count: 12 }],
    ]);
  });

  it("holds report_view until the page is ready, then fires with the ready-time props", () => {
    const { rerender } = render(
      <ReportShell report="risk-rules" title="Risk" query="" ready={false} viewProps={{ row_count: 0 }} loading>
        <p>body</p>
      </ReportShell>,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();

    rerender(
      <ReportShell report="risk-rules" title="Risk" query="" ready viewProps={{ row_count: 7 }}>
        <p>body</p>
      </ReportShell>,
    );
    expect(track).toHaveBeenCalledWith("report_view", { report: "risk-rules", row_count: 7 });
  });

  it("shows the no-rows line and hides the body while loading", () => {
    const { rerender } = render(
      <ReportShell report="processes" title="Processes" query="zzz" loading>
        <p>rows</p>
      </ReportShell>,
    );
    expect(screen.queryByText("rows")).not.toBeInTheDocument();

    rerender(
      <ReportShell report="processes" title="Processes" query="zzz" noRows>
        <p>rows</p>
      </ReportShell>,
    );
    expect(screen.getByText(/No rows match/)).toBeInTheDocument();
    expect(screen.getByText("rows")).toBeInTheDocument();
  });
});
