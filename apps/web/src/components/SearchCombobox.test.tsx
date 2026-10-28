// @vitest-environment jsdom
// The search field's combobox parts: the input, the recent-searches dropdown
// and its keyboard map, and the clear button, composed the way ShellSearch
// composes them.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SearchField } from "./SearchBar";
import { SearchCombobox, SearchComboboxInput } from "./SearchCombobox";
import { SearchComboboxSuggestions } from "./SearchComboboxSuggestions";
import { SearchClear } from "./SearchClear";
import type { RecentSuggestion } from "../lib/recentSearches";

afterEach(cleanup);

interface ComboOver {
  query: string;
  recentSearches: RecentSuggestion[];
  onSubmit: () => boolean;
}

function setup(over: Partial<ComboOver> = {}) {
  const onRecentSelect = vi.fn();
  const onClear = vi.fn();
  const query = over.query ?? "";
  render(
    <SearchCombobox query={query} recentSearches={over.recentSearches ?? []} onRecentSelect={onRecentSelect} onSubmit={over.onSubmit}>
      <SearchField>
        <SearchComboboxInput value={query} onChange={vi.fn()} aria-label="Filter the Atlas" />
        <SearchClear onClick={onClear} />
      </SearchField>
      <SearchComboboxSuggestions />
    </SearchCombobox>,
  );
  return { onRecentSelect, onClear };
}

describe("SearchClear", () => {
  it("keeps its place but hides while the field is empty", () => {
    setup({ query: "" });
    expect(screen.getByLabelText("Clear search")).toHaveAttribute("data-state", "hidden");
    cleanup();
    setup({ query: "vat" });
    expect(screen.getByLabelText("Clear search")).toHaveAttribute("data-state", "visible");
  });

  it("calls its onClick when pressed", () => {
    const { onClear } = setup({ query: "vat" });
    fireEvent.click(screen.getByLabelText("Clear search"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("SearchCombobox parts", () => {
  it("throw outside a SearchCombobox", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<SearchClear />)).toThrow(/inside <SearchCombobox>/);
    spy.mockRestore();
  });

  it("run a caller's onKeyDown after the dropdown's own", () => {
    const onKeyDown = vi.fn();
    render(
      <SearchCombobox query="">
        <SearchComboboxInput value="" onChange={vi.fn()} onKeyDown={onKeyDown} />
      </SearchCombobox>,
    );
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "a" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});

describe("SearchCombobox recent searches", () => {
  // Recent suggestions are { q, n } objects; this helper attaches an arbitrary
  // result count to each query so tests can pass plain strings.
  const R = (...queries: string[]) => queries.map((q, i) => ({ q, n: (i + 1) * 10 }));
  // The visible query text of each rendered option (first <span>; the count is a
  // separate aria-hidden <span>).
  const optionQueries = () =>
    screen.getAllByRole("option").map((o) => o.querySelector("span")?.textContent);

  function setupRecent(over: Partial<ComboOver> = {}) {
    return setup({ recentSearches: R("vat", "jug", "pot", "dai"), ...over });
  }

  it("stays closed on the mount autofocus and opens on interaction", () => {
    setupRecent();
    // autoFocus fires once on mount — the dropdown must not open from it.
    expect(screen.queryByRole("listbox", { name: "Recent searches" })).toBeNull();
    fireEvent.pointerDown(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox", { name: "Recent searches" })).toBeTruthy();
  });

  it("hides shortly after blur", () => {
    vi.useFakeTimers();
    try {
      setupRecent();
      const input = screen.getByRole("combobox");
      fireEvent.pointerDown(input);
      expect(screen.getByRole("listbox", { name: "Recent searches" })).toBeTruthy();
      fireEvent.blur(input);
      act(() => vi.runAllTimers()); // blur hides after a short delay (lets clicks land first)
      expect(screen.queryByRole("listbox", { name: "Recent searches" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows at most six recents", () => {
    setupRecent({ recentSearches: R("a", "b", "c", "d", "e", "f", "g") });
    fireEvent.pointerDown(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option")).toHaveLength(6);
    expect(screen.queryByText("g")).toBeNull(); // the 7th is dropped
  });

  it("shows each recent's result count (and names it for assistive tech)", () => {
    setupRecent({ recentSearches: [{ q: "vat", n: 42 }, { q: "jug", n: 1 }] });
    fireEvent.pointerDown(screen.getByRole("combobox"));
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByRole("option", { name: "vat, 42 results" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "jug, 1 result" })).toBeTruthy();
  });

  it("hides when the typed term is a prefix of no recent", () => {
    setupRecent({ query: "amat" }); // none of vat/jug/pot/dai start with "amat"
    fireEvent.pointerDown(screen.getByRole("combobox"));
    expect(screen.queryByRole("listbox", { name: "Recent searches" })).toBeNull();
  });

  it("narrows to recents that start with the typed term", () => {
    setupRecent({ query: "j", recentSearches: R("jug", "jar", "vat", "pot") });
    fireEvent.pointerDown(screen.getByRole("combobox"));
    expect(optionQueries()).toEqual(["jug", "jar"]);
  });

  it("matches the prefix case-insensitively and excludes the exact term", () => {
    setupRecent({ query: "VA", recentSearches: R("vat", "value", "jug") });
    fireEvent.pointerDown(screen.getByRole("combobox"));
    expect(optionQueries()).toEqual(["vat", "value"]);
  });

  it("excludes the exact term case-insensitively", () => {
    setupRecent({ query: "VAT", recentSearches: R("vat", "vatican") });
    fireEvent.pointerDown(screen.getByRole("combobox"));
    // "vat" is the same search as "VAT" so it's dropped; "vatican" still matches.
    expect(optionQueries()).toEqual(["vatican"]);
  });

  it("treats the bare phrase/strict quote markers as empty", () => {
    for (const q of ['""', "''"]) {
      setupRecent({ query: q });
      fireEvent.pointerDown(screen.getByRole("combobox"));
      expect(screen.getByRole("listbox", { name: "Recent searches" })).toBeTruthy();
      cleanup();
    }
  });

  it("re-summons the dropdown when Backspace is pressed on an empty field", () => {
    vi.useFakeTimers();
    try {
      setupRecent(); // query is ""
      const input = screen.getByRole("combobox");
      fireEvent.pointerDown(input);
      expect(screen.getByRole("listbox", { name: "Recent searches" })).toBeTruthy();
      // Simulate a stray blur that stranded `focused` off while typing.
      fireEvent.blur(input);
      act(() => vi.runAllTimers());
      expect(screen.queryByRole("listbox", { name: "Recent searches" })).toBeNull();
      // Backspace on the empty field brings it back without a re-click.
      fireEvent.keyDown(input, { key: "Backspace" });
      expect(screen.getByRole("listbox", { name: "Recent searches" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not re-summon on Backspace when the field has text", () => {
    setupRecent({ query: "amat" });
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(screen.queryByRole("listbox", { name: "Recent searches" })).toBeNull();
  });

  it("calls onRecentSelect with the chosen query and its rank", () => {
    const { onRecentSelect } = setupRecent();
    fireEvent.pointerDown(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("jug"));
    expect(onRecentSelect).toHaveBeenCalledWith("jug", 1); // 0-based index in [vat, jug, pot]
  });

  it("renders nothing when there are no recents", () => {
    setupRecent({ recentSearches: [] });
    fireEvent.pointerDown(screen.getByRole("combobox"));
    expect(screen.queryByRole("listbox", { name: "Recent searches" })).toBeNull();
  });

  it("Tab highlights the first option and keeps the dropdown open", () => {
    setupRecent();
    const input = screen.getByRole("combobox");
    fireEvent.pointerDown(input);
    fireEvent.keyDown(input, { key: "Tab" });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    // Focus stays on the input; the highlight is tracked via aria-activedescendant.
    expect(input).toHaveAttribute("aria-activedescendant", "recent-search-listbox-opt-0");
    expect(screen.getByRole("listbox", { name: "Recent searches" })).toBeTruthy();
  });

  it("ArrowDown / ArrowUp move the highlight, and Up off the top clears it", () => {
    setupRecent();
    const input = screen.getByRole("combobox");
    fireEvent.pointerDown(input);
    fireEvent.keyDown(input, { key: "ArrowDown" }); // none -> first
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // first -> second
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowUp" }); // second -> first
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowUp" }); // first -> none
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  it("ArrowDown stops at the last option", () => {
    setupRecent(); // 4 recents → 4 options
    const input = screen.getByRole("combobox");
    fireEvent.pointerDown(input);
    for (let i = 0; i < 10; i++) fireEvent.keyDown(input, { key: "ArrowDown" });
    const opts = screen.getAllByRole("option");
    expect(opts[opts.length - 1]).toHaveAttribute("aria-selected", "true");
  });

  it("Enter runs the highlighted suggestion", () => {
    const { onRecentSelect } = setupRecent();
    const input = screen.getByRole("combobox");
    fireEvent.pointerDown(input);
    fireEvent.keyDown(input, { key: "Tab" }); // highlight vat (rank 0)
    fireEvent.keyDown(input, { key: "ArrowDown" }); // -> jug (rank 1)
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRecentSelect).toHaveBeenCalledWith("jug", 1);
  });

  it("Enter with nothing highlighted does not select", () => {
    const { onRecentSelect } = setupRecent();
    const input = screen.getByRole("combobox");
    fireEvent.pointerDown(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRecentSelect).not.toHaveBeenCalled();
  });

  it("Enter hands off to onSubmit when no recent is highlighted", () => {
    const onSubmit = vi.fn(() => true);
    setupRecent({ onSubmit });
    const input = screen.getByRole("combobox");
    fireEvent.pointerDown(input); // dropdown open, nothing highlighted
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("Enter selects a highlighted recent instead of calling onSubmit", () => {
    const onSubmit = vi.fn(() => true);
    const { onRecentSelect } = setupRecent({ onSubmit });
    const input = screen.getByRole("combobox");
    fireEvent.pointerDown(input);
    fireEvent.keyDown(input, { key: "Tab" }); // highlight the first recent
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRecentSelect).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Escape closes the dropdown", () => {
    setupRecent();
    const input = screen.getByRole("combobox");
    fireEvent.pointerDown(input);
    expect(screen.getByRole("listbox", { name: "Recent searches" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Recent searches" })).toBeNull();
  });

  const selectedCount = () =>
    screen.getAllByRole("option").filter((o) => o.getAttribute("aria-selected") === "true").length;

  it("hovering a row makes it the only highlighted one", () => {
    setupRecent();
    fireEvent.pointerDown(screen.getByRole("combobox"));
    const opts = screen.getAllByRole("option");
    fireEvent.mouseMove(opts[2]);
    expect(opts[2]).toHaveAttribute("aria-selected", "true");
    expect(selectedCount()).toBe(1);
  });

  it("the most recent of keyboard / mouse wins the single highlight", () => {
    setupRecent({ recentSearches: R("a", "b", "c", "d", "e", "f") });
    const input = screen.getByRole("combobox");
    fireEvent.pointerDown(input);

    fireEvent.keyDown(input, { key: "ArrowDown" }); // keyboard → index 0
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.mouseMove(screen.getAllByRole("option")[3]); // hover wins → index 3
    expect(screen.getAllByRole("option")[3]).toHaveAttribute("aria-selected", "true");
    expect(selectedCount()).toBe(1);

    fireEvent.keyDown(input, { key: "ArrowDown" }); // keyboard wins, continues → index 4
    expect(screen.getAllByRole("option")[4]).toHaveAttribute("aria-selected", "true");
    expect(selectedCount()).toBe(1);
  });
});
