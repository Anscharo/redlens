// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ModFrequencyTable } from "./ModFrequencyTable";
import { EMPTY_QUERY, parseReportQuery } from "@/lib/reportFilter";
import type { ModFrequencyGroup, ModFrequencyRow } from "../../lib/modFrequencyIndex";

afterEach(cleanup);

function row(over: Partial<ModFrequencyRow>): ModFrequencyRow {
  return {
    id: "uuid-1",
    docNo: "A.1.1",
    title: "A Document",
    type: "Article",
    section: "A.1",
    sectionTitle: "A Scope",
    count: 3,
    lastModified: "2026-01-05",
    agent: null,
    ...over,
  };
}

const ONE_GROUP: ModFrequencyGroup = {
  key: "A.1",
  label: "A.1 — A Scope",
  rows: [row({})],
};

describe("ModFrequencyTable", () => {
  it("renders a row with doc no, title, type, edit count, and last modified", () => {
    render(<ModFrequencyTable group={ONE_GROUP} rq={EMPTY_QUERY} showSection={false} />);
    expect(screen.getByRole("link", { name: "A.1.1" })).toHaveAttribute("href", "/atlas?id=uuid-1");
    expect(screen.getByText("A Document")).toBeInTheDocument();
    expect(screen.getByText("Article")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2026-01-05")).toBeInTheDocument();
  });

  it("shows 'never' for a row with no lastModified", () => {
    const group: ModFrequencyGroup = { ...ONE_GROUP, rows: [row({ count: 0, lastModified: null })] };
    render(<ModFrequencyTable group={group} rq={EMPTY_QUERY} showSection={false} />);
    expect(screen.getByText("never")).toBeInTheDocument();
  });

  it("hides the Section column and cell when showSection is false", () => {
    render(<ModFrequencyTable group={ONE_GROUP} rq={EMPTY_QUERY} showSection={false} />);
    expect(screen.queryByRole("columnheader", { name: "Section" })).not.toBeInTheDocument();
    expect(screen.queryByText("A Scope")).not.toBeInTheDocument();
  });

  it("shows the Section column, combining section + sectionTitle, when showSection is true", () => {
    render(<ModFrequencyTable group={ONE_GROUP} rq={EMPTY_QUERY} showSection />);
    expect(screen.getByRole("columnheader", { name: "Section" })).toBeInTheDocument();
    expect(screen.getByText("A.1 A Scope")).toBeInTheDocument();
  });

  it("shows only the section doc_no when sectionTitle falls back to section itself (e.g. NR family)", () => {
    const group: ModFrequencyGroup = {
      key: "NR",
      label: "NR",
      rows: [row({ id: "uuid-nr", docNo: "NR-1", section: "NR", sectionTitle: "NR" })],
    };
    render(<ModFrequencyTable group={group} rq={EMPTY_QUERY} showSection />);
    // The heading also reads "NR" (the group label) — scope to the cell.
    expect(screen.getAllByText("NR")).toHaveLength(2);
    expect(screen.queryByText("NR NR")).not.toBeInTheDocument();
  });

  it("highlights matches in the doc no, title, and type cells for a query", () => {
    const rq = parseReportQuery("document", "broad");
    render(<ModFrequencyTable group={ONE_GROUP} rq={rq} showSection={false} />);
    expect(screen.getByText("Document").closest("mark")).toBeInTheDocument();
  });

  it("shows every row up to the page size with no show-more button", () => {
    const rows = Array.from({ length: 100 }, (_, i) => row({ id: `uuid-${i}`, docNo: `A.1.${i}`, title: `Doc ${i}` }));
    const group: ModFrequencyGroup = { key: "A.1", label: "A.1", rows };
    render(<ModFrequencyTable group={group} rq={EMPTY_QUERY} showSection={false} />);
    expect(screen.getByText("Doc 99")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show.*more/i })).not.toBeInTheDocument();
  });

  it("pages a group beyond the page size via the show-more button", () => {
    const rows = Array.from({ length: 150 }, (_, i) => row({ id: `uuid-${i}`, docNo: `A.1.${i}`, title: `Doc ${i}` }));
    const group: ModFrequencyGroup = { key: "A.1", label: "A.1 (150)", rows };
    render(<ModFrequencyTable group={group} rq={EMPTY_QUERY} showSection={false} />);

    // Total shown in the heading is the group's full count, not just the paged-in count.
    expect(screen.getByRole("heading", { name: /150/ })).toBeInTheDocument();
    expect(screen.getByText("Doc 0")).toBeInTheDocument();
    expect(screen.queryByText("Doc 149")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show 50 more \(50 remaining\)/i }));
    expect(screen.getByText("Doc 149")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show.*more/i })).not.toBeInTheDocument();
  });

  it("resets to one page when the group's row set changes (e.g. a new filter/group selection)", () => {
    const manyRows = Array.from({ length: 150 }, (_, i) => row({ id: `uuid-${i}`, docNo: `A.1.${i}`, title: `Doc ${i}` }));
    const groupA: ModFrequencyGroup = { key: "A.1", label: "A.1", rows: manyRows };
    const { rerender } = render(<ModFrequencyTable group={groupA} rq={EMPTY_QUERY} showSection={false} />);
    fireEvent.click(screen.getByRole("button", { name: /show.*more/i }));
    expect(screen.getByText("Doc 149")).toBeInTheDocument();

    const groupB: ModFrequencyGroup = { key: "A.2", label: "A.2", rows: [row({ id: "uuid-b", docNo: "A.2.1", title: "Other Doc" })] };
    rerender(<ModFrequencyTable group={groupB} rq={EMPTY_QUERY} showSection={false} />);
    expect(screen.getByText("Other Doc")).toBeInTheDocument();
    expect(screen.queryByText("Doc 0")).not.toBeInTheDocument();
  });
});
