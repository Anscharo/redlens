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
    setup(done(), { shown: 3, total: 3, durationMs: null });
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
  });

  it("leaves the in-flight wording to the progress bar instead of repeating it", () => {
    // <SemanticProgress /> renders on this exact condition and names the stage,
    // so a note here was the same sentence twice, quieter, directly under it.
    setup(done({ semantic: "pending" }));
    expect(screen.queryByText(/scoring by meaning/)).toBeNull();
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

describe("syntax the meaning lane cannot honour", () => {
  it("names what was stripped, and why, beside the results it did find", () => {
    setup(done({ semantic: "done", query: "type:Core rewards", lane: "semantic" }), {
      lane: "semantic",
      shown: 5,
      total: 5,
    });
    expect(
      screen.getByText("type:Core ignored — meaning search scores whole documents, not strings"),
    ).toBeInTheDocument();
  });

  it("lists every dropped operator, quoting included", () => {
    setup(done({ semantic: "done", query: 'type:Core "sky core" -fees', lane: "semantic" }), {
      lane: "semantic",
      shown: 2,
      total: 2,
    });
    expect(screen.getByText(/type:Core -fees "…" ignored/)).toBeInTheDocument();
  });

  it("never names in: — that filter is honoured here", () => {
    setup(done({ semantic: "done", query: "in:A.6 who approves rewards", lane: "semantic" }), {
      lane: "semantic",
      shown: 3,
      total: 3,
    });
    expect(screen.queryByText(/ignored/)).toBeNull();
  });

  it("says a query is too short to score, rather than just 'nothing to score'", () => {
    setup(done({ semantic: "none", query: "ab", lane: "semantic" }), { lane: "semantic" });
    expect(
      screen.getByText("too short to score by meaning (3 characters minimum) — showing wording matches"),
    ).toBeInTheDocument();
  });

  it("says what emptied the query when stripping is what left it too short", () => {
    // NOT "ignored": nothing embeddable was left, so the lane stood down and the
    // lexical leg answered — and that leg DID apply the exclusion.
    setup(done({ semantic: "none", query: "-fees", lane: "semantic" }), { lane: "semantic" });
    expect(
      screen.getByText("nothing left to score by meaning after -fees — showing wording matches"),
    ).toBeInTheDocument();
  });

  it("stays quiet on the wording lane, which honours the syntax", () => {
    setup(done({ semantic: "none", query: "type:Core rewards" }), { shown: 1, total: 1 });
    expect(screen.queryByText(/ignored/)).toBeNull();
  });
});

describe("a lane still loading", () => {
  it("says searching, not 'no results', while the caller reports work in flight", () => {
    // Without the caller's `pending` the page says "no results for …" while a
    // leg the reader is waiting on is still running.
    setup(done({ semantic: "none" }), { total: 0, pending: true, lane: "semantic" });
    expect(screen.getByText("searching…")).toBeInTheDocument();
    expect(screen.queryByText(/no results/)).toBeNull();
  });

  it("names a held word and says Enter searches anyway, on the meaning lane", () => {
    setup(done({ lane: "semantic", query: "xkcdq", heldWords: ["xkcdq"] }), { lane: "semantic" });
    expect(screen.getByText(/“xkcdq” doesn't look like a word.*press Enter to search by meaning anyway/)).toBeTruthy();
  });

  it("uses the plural for several held words", () => {
    setup(done({ lane: "semantic", query: "xkcdq qzx", heldWords: ["xkcdq", "qzx"] }), { lane: "semantic" });
    expect(screen.getByText(/“xkcdq”, “qzx” don't look like words/)).toBeTruthy();
  });

  it("says nothing about held words off the meaning lane", () => {
    setup(done({ heldWords: ["xkcdq"] }));
    expect(screen.queryByText(/look like/)).toBeNull();
  });
});

describe("Radar link", () => {
  it("links the query to Radar search, on either lane", () => {
    setup(done({ query: "keel & ops" }), { shown: 1, total: 1 });
    const link = screen.getByText("Search actors and instances on Radar →").closest("a");
    expect(link).toHaveAttribute("href", "/radar?q=keel%20%26%20ops");
    cleanup();
    setup(done({ query: "keel", lane: "semantic" }), { shown: 1, total: 1, lane: "semantic" });
    expect(screen.getByText("Search actors and instances on Radar →").closest("a")).toHaveAttribute(
      "href",
      "/radar?q=keel",
    );
  });

  it("is absent while the search is still running", () => {
    setup({ status: "searching" });
    expect(screen.queryByText("Search actors and instances on Radar →")).toBeNull();
  });
});
