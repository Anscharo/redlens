// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TraceRowView } from "./TraceRow";
import type { TraceRow } from "./useChatStream";

afterEach(cleanup);

describe("TraceRowView", () => {
  it("renders a tool row with formatted byte size and success arrow", () => {
    const row: TraceRow = { name: "atlas_query", args: { search: "gov" }, ok: true, bytes: 2048, round: 1 };
    render(<TraceRowView row={row} />);
    expect(screen.getByText("atlas_query")).toBeInTheDocument();
    expect(screen.getByText("search: gov")).toBeInTheDocument();
    expect(screen.getByText("2.0 kB")).toBeInTheDocument();
  });

  it("shows the error arrow and a pending byte count when ok is false and bytes is null", () => {
    const row: TraceRow = { name: "atlas_get", args: { id: "abc" }, ok: false, bytes: null, round: 1 };
    render(<TraceRowView row={row} />);
    expect(screen.getByText("×")).toBeInTheDocument();
    expect(screen.getByText("…")).toBeInTheDocument();
  });

  it("summarizes non-string args as JSON and formats sub-1KB byte counts", () => {
    const row: TraceRow = { name: "atlas_query", args: { limit: 5 }, ok: true, bytes: 100, round: 1 };
    render(<TraceRowView row={row} />);
    expect(screen.getByText("limit: 5")).toBeInTheDocument();
    expect(screen.getByText("100 B")).toBeInTheDocument();
  });

  it("shows a fired fact by its summary, with no call arrow or byte size", () => {
    const row: TraceRow = { name: "glossary", args: {}, ok: true, bytes: null, kind: "fact", summary: "2 glossary definitions", round: 0 };
    const { container } = render(<TraceRowView row={row} />);
    expect(screen.getByText("2 glossary definitions")).toBeInTheDocument();
    expect(screen.getByText("recalled")).toBeInTheDocument();
    expect(container.querySelector('[data-kind="fact"]')).toBeInTheDocument();
  });
});
