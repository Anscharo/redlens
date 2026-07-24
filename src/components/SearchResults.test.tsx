// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SearchResults } from "./SearchResults";
import type { SearchState } from "../hooks/useSearch";
import { makeSearchHit, makeGraphData, makeGraphEntity } from "../test/fixtures";

const mocks = vi.hoisted(() => ({
  loadGraph: vi.fn(),
  track: vi.fn(),
}));
vi.mock("../lib/graph", () => ({ loadGraph: mocks.loadGraph }));
vi.mock("../lib/analytics", () => ({ track: mocks.track, captureException: vi.fn() }));

afterEach(() => {
  cleanup();
  mocks.track.mockClear();
  window.history.pushState({}, "", "/");
});

beforeEach(() => {
  // Default: no participants, so entity-hit branches don't fire unless a test opts in.
  mocks.loadGraph.mockResolvedValue(makeGraphData());
});

function setup(
  state: SearchState,
  overrides: Partial<{ query: string; mode: "broad" | "phrase" | "strict"; onHintClick: (q: string) => void; onBroadSearch: (q: string) => void }> = {},
) {
  const onHintClick = overrides.onHintClick ?? vi.fn();
  const onBroadSearch = overrides.onBroadSearch ?? vi.fn();
  const utils = render(
    <SearchResults
      state={state}
      query={overrides.query ?? ""}
      mode={overrides.mode ?? "broad"}
      onHintClick={onHintClick}
      onBroadSearch={onBroadSearch}
    />,
  );
  return { ...utils, onHintClick, onBroadSearch };
}

describe("SearchResults status branches", () => {
  it("idle status with a slash query renders SearchHints", () => {
    setup({ status: "idle" }, { query: "/r" });
    expect(screen.getByText("/reports")).toBeTruthy();
  });

  it("idle status with a non-slash query renders nothing (no hints, no results banner)", () => {
    setup({ status: "idle" }, { query: "vat" });
    expect(screen.queryByText(/results/)).toBeNull();
    expect(screen.queryByText("/reports")).toBeNull();
  });

  it("searching status shows the searching indicator", () => {
    setup({ status: "searching" }, { query: "vat" });
    expect(screen.getByText("searching…")).toBeTruthy();
  });

  it("loading status with a slash query also renders SearchHints", () => {
    setup({ status: "loading" }, { query: "/rad" });
    expect(screen.getByText("/radar")).toBeTruthy();
  });

  it("error status shows the error message", () => {
    setup({ status: "error", message: "search index failed to load" }, { query: "vat" });
    expect(screen.getByText("search index failed to load")).toBeTruthy();
  });

  it("done status with hits renders the result count, duration, and each result", () => {
    const hits = [
      makeSearchHit({ title: "Alpha", titleHtml: "Alpha" }),
      makeSearchHit({ title: "Beta", titleHtml: "Beta" }),
    ];
    setup({ status: "done", hits, durationMs: 12.4, query: "vat" }, { query: "vat" });
    expect(screen.getByText(/2 results · 12ms/)).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("done status with a single hit uses singular 'result'", () => {
    setup(
      { status: "done", hits: [makeSearchHit()], durationMs: 1, query: "vat" },
      { query: "vat" },
    );
    expect(screen.getByText(/1 result ·/)).toBeTruthy();
  });

  it("done status with zero hits shows the no-results message", () => {
    setup({ status: "done", hits: [], durationMs: 3, query: "zzz" }, { query: "zzz" });
    expect(screen.getByText('no results for "zzz"')).toBeTruthy();
  });
});

describe("SearchResults no-results suggestions", () => {
  it("suggests a broad search when the mode is non-broad and there are no results", () => {
    const { onBroadSearch } = setup(
      { status: "done", hits: [], durationMs: 1, query: '"delegated signers"' },
      { query: '"delegated signers"', mode: "phrase" },
    );
    const btn = screen.getByText(/try broad:/);
    fireEvent.click(btn);
    expect(onBroadSearch).toHaveBeenCalledWith("delegated signers");
  });

  it("suggests a fuzzy search when broad mode yields no results and query has no ~", () => {
    const { onHintClick } = setup(
      { status: "done", hits: [], durationMs: 1, query: "delegated signers" },
      { query: "delegated signers", mode: "broad" },
    );
    const btn = screen.getByText(/try fuzzy:/);
    fireEvent.click(btn);
    expect(onHintClick).toHaveBeenCalledWith("delegated~2 signers~2");
  });

  it("does not suggest fuzzy when the query already contains ~", () => {
    setup(
      { status: "done", hits: [], durationMs: 1, query: "delegated~1" },
      { query: "delegated~1", mode: "broad" },
    );
    expect(screen.queryByText(/try fuzzy:/)).toBeNull();
  });

  it("does not suggest broad or fuzzy when there are results", () => {
    setup(
      { status: "done", hits: [makeSearchHit()], durationMs: 1, query: "vat" },
      { query: "vat" },
    );
    expect(screen.queryByText(/try broad:/)).toBeNull();
    expect(screen.queryByText(/try fuzzy:/)).toBeNull();
  });
});

describe("SearchResults pagination", () => {
  it("shows a 'show more' button when more hits exist than the URL-restored visible count, and paging increases the visible count", async () => {
    window.history.pushState({}, "", "/?n=2");
    const hits = [
      makeSearchHit({ title: "One", titleHtml: "One" }),
      makeSearchHit({ title: "Two", titleHtml: "Two" }),
      makeSearchHit({ title: "Three", titleHtml: "Three" }),
      makeSearchHit({ title: "Four", titleHtml: "Four" }),
    ];
    setup({ status: "done", hits, durationMs: 1, query: "vat" }, { query: "vat" });

    expect(screen.getByText("One")).toBeTruthy();
    expect(screen.getByText("Two")).toBeTruthy();
    expect(screen.queryByText("Three")).toBeNull();
    expect(screen.getByText(/show 2 more \(2 remaining\)/)).toBeTruthy();

    fireEvent.click(screen.getByText(/show 2 more/));
    await waitFor(() => expect(screen.getByText("Three")).toBeTruthy());
    expect(screen.getByText("Four")).toBeTruthy();
    expect(screen.queryByText(/show.*more/)).toBeNull();
  });
});

describe("SearchResults entity hits", () => {
  it("renders matching entities from the graph, capped, with a link to their profile", async () => {
    const participants = [
      makeGraphEntity({ id: "e-1", slug: "keel", name: "Keel", et: "agent", st: "prime" }),
      makeGraphEntity({ id: "e-2", slug: "keel-ops", name: "Keel Ops", et: "agent", st: null }),
    ];
    mocks.loadGraph.mockResolvedValue(makeGraphData({ participants }));
    setup(
      { status: "done", hits: [], durationMs: 1, query: "keel" },
      { query: "keel" },
    );
    await waitFor(() => expect(screen.getByText("Keel")).toBeTruthy());
    expect(screen.getByText("Keel Ops")).toBeTruthy();
    expect(screen.getByText(/Agents · Alignment Conservers · Governance Operators 2/)).toBeTruthy();
    const link = screen.getByText("Keel").closest("a")!;
    expect(link).toHaveAttribute("href", "/radar/keel");
  });

  it("does not show entity hits for an empty or slash-prefixed query", async () => {
    const participants = [makeGraphEntity({ id: "e-1", slug: "keel", name: "Keel", et: "agent" })];
    mocks.loadGraph.mockResolvedValue(makeGraphData({ participants }));
    setup({ status: "idle" }, { query: "/reports" });
    await waitFor(() => expect(mocks.loadGraph).toHaveBeenCalled());
    expect(screen.queryByText("Keel")).toBeNull();
  });
});
