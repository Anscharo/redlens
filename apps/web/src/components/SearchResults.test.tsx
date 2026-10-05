// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SearchResults } from "./SearchResults";
import type { SearchState } from "../hooks/useSearch";
import type { SearchLane } from "@/lib/searchSemantic";
import { makeSearchHit, makeSearchState } from "../test/fixtures";

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
}));
vi.mock("../lib/analytics", () => ({ track: mocks.track, captureException: vi.fn() }));

afterEach(() => {
  cleanup();
  mocks.track.mockClear();
  window.history.pushState({}, "", "/");
});

function setup(
  state: SearchState,
  overrides: Partial<{ query: string; mode: "broad" | "phrase" | "strict"; lane: SearchLane; onHintClick: (q: string) => void; onBroadSearch: (q: string) => void; onLaneSelect: (lane: SearchLane) => void }> = {},
) {
  const onHintClick = overrides.onHintClick ?? vi.fn();
  const onBroadSearch = overrides.onBroadSearch ?? vi.fn();
  const onLaneSelect = overrides.onLaneSelect ?? vi.fn();
  const utils = render(
    <SearchResults
      state={state}
      query={overrides.query ?? ""}
      mode={overrides.mode ?? "broad"}
      lane={overrides.lane ?? "lexical"}
      onLaneSelect={onLaneSelect}
      onHintClick={onHintClick}
      onBroadSearch={onBroadSearch}
    />,
  );
  return { ...utils, onHintClick, onBroadSearch, onLaneSelect };
}

describe("SearchResults meaning-lane progress", () => {
  it("shows the progress bar while the meaning leg is in flight", async () => {
    setup(makeSearchState({ semantic: "pending" }), { query: "vat", lane: "semantic" });
    // The bar waits out its own appear delay, so this is a real timer.
    await waitFor(() => expect(screen.getByText("Computing multidimensional vectors")).toBeTruthy());
  });

  it("shows no bar once the meaning leg has answered", () => {
    setup(makeSearchState({ semantic: "done" }), { query: "vat", lane: "semantic" });
    expect(screen.queryByText("Computing multidimensional vectors")).toBeNull();
  });
});

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
    setup(makeSearchState({ hits, durationMs: 12.4 }), { query: "vat" });
    expect(screen.getByText(/2 results · 12ms/)).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("done status with a single hit uses singular 'result'", () => {
    setup(
      makeSearchState({ hits: [makeSearchHit()] }),
      { query: "vat" },
    );
    expect(screen.getByText(/1 result ·/)).toBeTruthy();
  });

  it("done status with zero hits shows the no-results message", () => {
    setup(makeSearchState({ durationMs: 3, query: "zzz" }), { query: "zzz" });
    expect(screen.getByText('no results for "zzz"')).toBeTruthy();
  });
});

describe("SearchResults no-results suggestions", () => {
  it("suggests a broad search when the mode is non-broad and there are no results", () => {
    const { onBroadSearch } = setup(
      makeSearchState({ query: '"delegated signers"' }),
      { query: '"delegated signers"', mode: "phrase" },
    );
    const btn = screen.getByText(/try broad:/);
    fireEvent.click(btn);
    expect(onBroadSearch).toHaveBeenCalledWith("delegated signers");
  });

  it("offers a clickable spelling correction when a search found nothing", () => {
    const onHintClick = vi.fn();
    setup(makeSearchState({ query: "governence", didYouMean: "governance" }), {
      query: "governence",
      onHintClick,
    });
    const btn = screen.getByRole("button", { name: "governance" });
    fireEvent.click(btn);
    expect(onHintClick).toHaveBeenCalledWith("governance");
  });

  it("offers nothing when the worker found no correction worth making", () => {
    // A "did you mean" the worker could not verify is worse than silence.
    setup(makeSearchState({ query: "zzzznope" }), { query: "zzzznope" });
    expect(screen.queryByText(/Did you mean/)).toBeNull();
  });

  it("never suggests the ~ fuzzy operator — that asked the reader to learn syntax", () => {
    setup(makeSearchState({ query: "governence", didYouMean: "governance" }), { query: "governence" });
    expect(screen.queryByText(/try fuzzy/)).toBeNull();
    expect(screen.queryByText(/~2/)).toBeNull();
  });

  it("does not suggest fuzzy when the query already contains ~", () => {
    setup(
      makeSearchState({ query: "delegated~1" }),
      { query: "delegated~1", mode: "broad" },
    );
    expect(screen.queryByText(/try fuzzy:/)).toBeNull();
  });

  it("does not suggest broad or fuzzy when there are results", () => {
    setup(
      makeSearchState({ hits: [makeSearchHit()] }),
      { query: "vat" },
    );
    expect(screen.queryByText(/try broad:/)).toBeNull();
    expect(screen.queryByText(/try fuzzy:/)).toBeNull();
  });

  it("does not offer 'try broad' off the wording lane", () => {
    // The meaning lane drops the quotes before embedding, so re-running the same
    // words broad would send the identical request — the status line says the
    // quoting was ignored instead.
    setup(
      makeSearchState({ query: '"delegated signers"', lane: "semantic", semantic: "done" }),
      { query: '"delegated signers"', mode: "phrase", lane: "semantic" },
    );
    expect(screen.queryByText(/try broad:/)).toBeNull();
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
    setup(makeSearchState({ hits }), { query: "vat" });

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
