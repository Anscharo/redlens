// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

Element.prototype.scrollIntoView = vi.fn();
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import type { StaleDatesReport as StaleDatesReportData, DateClaim } from "../../lib/staleDates";

function claim(over: Partial<DateClaim>): DateClaim {
  return {
    docId: "d-1",
    docNo: "A.1.1",
    title: "Spark Vote",
    raw: "31 July 2026",
    dateISO: "2026-07-31",
    precision: "day",
    context: "will be included in the Executive Vote",
    contextBefore: "will be included in the ",
    contextAfter: " Executive Vote",
    daysUntilStale: 5,
    transition: false,
    ...over,
  };
}

const staleClaim = claim({
  docId: "d-stale",
  docNo: "A.1.2",
  title: "Overdue Handoff",
  raw: "1 January 2026",
  dateISO: "2026-01-01",
  daysUntilStale: -30,
  transition: true,
});
const upcomingClaim = claim({ docId: "d-up", docNo: "A.1.3", title: "Future Milestone", daysUntilStale: 60 });
const dueSoonClaim = claim({ docId: "d-due", docNo: "A.1.4", title: "Imminent Deadline", daysUntilStale: 3 });

const reportFixture: StaleDatesReportData = {
  stale: [staleClaim],
  dueSoon: [dueSoonClaim],
  upcoming: [upcomingClaim],
  totalDateMentions: 3,
};

let buildImpl = () => reportFixture;

vi.mock("../../lib/docs", () => ({ loadDocs: () => Promise.resolve({}) }));
vi.mock("../../lib/staleDates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/staleDates")>();
  return {
    ...actual,
    buildStaleDatesReport: () => buildImpl(),
  };
});

import { StaleDatesReport } from "./StaleDatesReport";
import { ErrorBoundary } from "../ErrorBoundary";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
  buildImpl = () => reportFixture;
  vi.restoreAllMocks();
});

describe("StaleDatesReport", () => {
  it("renders the three buckets with their claim titles, counts, and staleness copy", async () => {
    render(<StaleDatesReport query="" mode="broad" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    expect(await screen.findByText("Future Milestone")).toBeInTheDocument();
    expect(screen.getByText("Imminent Deadline")).toBeInTheDocument();
    expect(screen.getByText("Overdue Handoff")).toBeInTheDocument();

    // Section headings with counts.
    expect(screen.getByRole("heading", { name: "Upcoming (1)" })).toBeInTheDocument();
    expect(screen.getByText(/Due within \d+ days/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Stale (1)" })).toBeInTheDocument();

    // Staleness copy: overdue vs in-future.
    expect(screen.getByText("(30d overdue)")).toBeInTheDocument();
    expect(screen.getByText("(in 60d)")).toBeInTheDocument();

    // Transition badge only on the transition claim.
    expect(screen.getByText("handoff")).toBeInTheDocument();

    // Scanned mentions count from the report.
    expect(screen.getByText(/3 dated mentions scanned/)).toBeInTheDocument();
  });

  it("filters claims by the query prop within each bucket", async () => {
    render(<StaleDatesReport query="overdue handoff" mode="broad" />);
    // Titles get split across <mark> nodes once highlighted, so match on the
    // row's title attribute instead of the rendered (fragmented) text.
    expect(await screen.findByTitle("Overdue Handoff")).toBeInTheDocument();
    expect(screen.queryByTitle("Future Milestone")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Imminent Deadline")).not.toBeInTheDocument();
  });

  it("shows NoRowsMatch when a query matches nothing (only once a query is present)", async () => {
    render(<StaleDatesReport query="zzz-no-match-at-all" mode="broad" />);
    expect(await screen.findByText(/No rows match/)).toBeInTheDocument();
  });

  it("renders empty-bucket copy when a query clears an entire section but not others", async () => {
    // Use a query unique to a single claim so other buckets render "none" once
    // rows are filtered within their own section.
    render(<StaleDatesReport query="milestone" mode="broad" />);
    expect(await screen.findByTitle("Future Milestone")).toBeInTheDocument();
    expect(screen.getAllByText("none").length).toBeGreaterThan(0);
  });

  it("shows the CSV download controls once loaded", async () => {
    render(<StaleDatesReport query="" mode="broad" />);
    expect(await screen.findByText("Download full report")).toBeInTheDocument();
  });

  it("builds and downloads a CSV when the download button is clicked", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    render(<StaleDatesReport query="" mode="broad" />);
    await screen.findByText("Download full report");
    fireEvent.click(screen.getByText("Download full report"));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("builds the filtered CSV when the filtered download button is clicked", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    render(<StaleDatesReport query="milestone" mode="broad" />);
    await screen.findByTitle("Future Milestone");
    fireEvent.click(screen.getByText("Download filtered report"));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  // The page no longer carries its own error + retry UI: useLoaded re-throws a
  // load failure during render, so the route's ErrorBoundary (App wraps every
  // route, resetKey={location}) owns the error page for reports too.
  it("surfaces a load failure to the surrounding ErrorBoundary instead of a spinner", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const docsModule = await import("../../lib/docs");
    vi.spyOn(docsModule, "loadDocs").mockImplementationOnce(() => Promise.reject(new Error("boom")));

    render(
      <ErrorBoundary fallback={(error) => <p>page failed to load: {error.message}</p>}>
        <StaleDatesReport query="" mode="broad" />
      </ErrorBoundary>,
    );
    expect(await screen.findByText(/page failed to load: boom/)).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });
});
