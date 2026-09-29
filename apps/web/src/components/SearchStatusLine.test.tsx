// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SearchStatusLine } from "./SearchStatusLine";
import type { SearchState } from "../hooks/useSearch";
import type { SemanticLegStatus } from "@/types";

afterEach(cleanup);

function done(over: Partial<Extract<SearchState, { status: "done" }>> = {}): SearchState {
  return {
    status: "done",
    hits: [],
    durationMs: 12.4,
    query: "rewards",
    lane: "lexical",
    semantic: "none" as SemanticLegStatus,
    ...over,
  };
}

function setup(state: SearchState, over: Partial<Parameters<typeof SearchStatusLine>[0]> = {}) {
  render(
    <SearchStatusLine
      state={state}
      shown={0}
      total={0}
      durationMs={state.status === "done" ? state.durationMs : null}
      pending={state.status === "done" && state.semantic === "pending"}
      lane="lexical"
      onLaneSelect={vi.fn()}
      semanticAvailable
      {...over}
    />,
  );
}

describe("SearchStatusLine", () => {
  it("counts results and reports the duration", () => {
    setup(done(), { shown: 20, total: 20 });
    expect(screen.getByText("20 results · 12ms")).toBeTruthy();
  });

  it("says how many of how many once the list is paginated", () => {
    setup(done(), { shown: 500, total: 1200 });
    expect(screen.getByText("500 of 1200 results · 12ms")).toBeTruthy();
  });

  it("omits the duration when there is no honest one to report", () => {
    // The entities lane has no timing of its own; showing the document search's
    // would be a made-up number.
    setup(done(), { shown: 3, total: 3, durationMs: null, lane: "graph" });
    expect(screen.getByText("3 results")).toBeTruthy();
  });

  it("says 'no results' only once nothing more is coming", () => {
    setup(done({ semantic: "none" }));
    expect(screen.getByText('no results for "rewards"')).toBeTruthy();
  });

  it("keeps searching while the semantic leg is in flight", () => {
    // This is the whole point of the fallback strategy: "no results" must not
    // flash before the meaning hits that are about to answer the query.
    setup(done({ semantic: "pending" }));
    expect(screen.queryByText('no results for "rewards"')).toBeNull();
    expect(screen.getByText("searching…")).toBeTruthy();
    expect(screen.getByText("scoring by meaning…")).toBeTruthy();
  });

  it("surfaces a degraded leg with its reason rather than swallowing it", () => {
    setup(done({ semantic: "skipped", semanticNote: "embed timed out after 10000ms" }), { shown: 2, total: 2 });
    expect(screen.getByText(/embed timed out after 10000ms/)).toBeTruthy();
  });

  it("says when the deployment cannot answer the lane at all", () => {
    setup(done({ semantic: "unavailable" }), { shown: 2, total: 2 });
    expect(screen.getByText("meaning search is not configured here")).toBeTruthy();
  });

  it("explains a declined query only on the lane the reader picked", () => {
    setup(done({ semantic: "none", lane: "semantic" }), { shown: 1, total: 1, lane: "semantic" });
    expect(screen.getByText("nothing to score by meaning — showing wording matches")).toBeTruthy();
    cleanup();
    // On the wording lane, "no semantic leg ran" is the normal case and needs
    // no commentary.
    setup(done({ semantic: "none" }), { shown: 1, total: 1 });
    expect(screen.queryByText(/nothing to score/)).toBeNull();
  });

  it("carries the lane picker", () => {
    setup(done());
    expect(screen.getByRole("radiogroup", { name: "Search index" })).toBeTruthy();
  });
});

describe("a lane still loading", () => {
  it("says searching, not 'no results', while the caller reports work in flight", () => {
    // The entities lane is the case this exists for: its hits come from the
    // graph worker, which has no `state.semantic` to report through, so the
    // page used to say "no results for …" on every keystroke until
    // relations.json finished loading.
    setup(done({ semantic: "none" }), { total: 0, pending: true, lane: "graph" });
    expect(screen.getByText("searching…")).toBeInTheDocument();
    expect(screen.queryByText(/no results/)).toBeNull();
  });
});
