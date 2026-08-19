// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToolTrace } from "./ToolTrace";
import type { TraceRow } from "./useChatStream";

afterEach(cleanup);

describe("ToolTrace", () => {
  it("renders nothing when there is no trace", () => {
    const { container } = render(<ToolTrace trace={[]} rounds={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("summarizes a single lookup and is collapsed by default", () => {
    const trace: TraceRow[] = [{ name: "atlas_get", args: { id: "doc-1" }, ok: true, bytes: 500 }];
    render(<ToolTrace trace={trace} rounds={1} />);
    expect(screen.getByText("looked up 1 thing over the atlas")).toBeInTheDocument();
    expect(screen.queryByText("atlas_get")).toBeNull();
    expect(screen.queryByText(/rounds/)).toBeNull();
  });

  it("uses plural phrasing for multiple lookups and shows round count above 1", () => {
    const trace: TraceRow[] = [
      { name: "atlas_query", args: { search: "x" }, ok: true, bytes: 1500 },
      { name: "atlas_get", args: { id: "doc" }, ok: false, bytes: null },
    ];
    render(<ToolTrace trace={trace} rounds={2} />);
    expect(screen.getByText("looked up 2 things over the atlas")).toBeInTheDocument();
    expect(screen.getByText("· 2 rounds")).toBeInTheDocument();
  });

  it("expands to show rows with formatted byte sizes and error state on click", () => {
    const trace: TraceRow[] = [
      { name: "atlas_query", args: { search: "gov" }, ok: true, bytes: 2048 },
      { name: "atlas_get", args: { id: "abc" }, ok: false, bytes: null },
    ];
    render(<ToolTrace trace={trace} rounds={1} />);
    const head = screen.getByRole("button");
    expect(head).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("atlas_query")).toBeInTheDocument();
    expect(screen.getByText("search: gov")).toBeInTheDocument();
    expect(screen.getByText("2.0 kB")).toBeInTheDocument();
    expect(screen.getByText("…")).toBeInTheDocument(); // still-pending bytes
    expect(screen.getByText("×")).toBeInTheDocument(); // error arrow
    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "false");
  });

  it("summarizes non-string args as JSON and formats sub-1KB byte counts", () => {
    const trace: TraceRow[] = [{ name: "atlas_query", args: { limit: 5 }, ok: true, bytes: 100 }];
    render(<ToolTrace trace={trace} rounds={1} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("limit: 5")).toBeInTheDocument();
    expect(screen.getByText("100 B")).toBeInTheDocument();
  });
});

describe("ToolTrace skill rows", () => {
  // The app-documentation answer needs no tool call at all — the header must
  // not claim an atlas lookup that never happened.
  it("says only what happened on a skills-only turn", () => {
    const trace: TraceRow[] = [
      { name: "features", args: {}, ok: true, bytes: null, kind: "skill", summary: "the app's features guide" },
    ];
    render(<ToolTrace trace={trace} rounds={0} />);
    expect(screen.getByText("recalled 1 thing")).toBeInTheDocument();
  });

  it("shows a fired skill by its summary, with no call arrow or byte size", () => {
    const trace: TraceRow[] = [
      { name: "glossary", args: {}, ok: true, bytes: null, kind: "skill", summary: "2 glossary definitions" },
      { name: "atlas_get", args: { id: "doc-1" }, ok: true, bytes: 500 },
    ];
    render(<ToolTrace trace={trace} rounds={1} />);
    expect(screen.getByText("recalled 1 thing · looked up 1 thing over the atlas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("2 glossary definitions")).toBeInTheDocument();
    expect(screen.getByText("recalled")).toBeInTheDocument();
    // The tool row keeps its own treatment.
    expect(screen.getByText("id: doc-1")).toBeInTheDocument();
    expect(screen.getByText("500 B")).toBeInTheDocument();
  });
});
