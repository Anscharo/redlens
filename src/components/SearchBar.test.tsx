// @vitest-environment jsdom
// SearchBar header: the broad/phrase/strict mode pills (atlas scope only), the
// scope chip (non-atlas scopes), and the clear button. NavBar and Tooltip are
// stubbed so the test stays focused on SearchBar's own controls.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { SearchBar } from "./SearchBar";
import type { SearchScope } from "../lib/routes";

vi.mock("./NavBar", () => ({ NavBar: () => <nav data-testid="navbar" /> }));
vi.mock("./Tooltip", () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

afterEach(cleanup);

function setup(over: Partial<Parameters<typeof SearchBar>[0]> = {}) {
  const onChange = vi.fn();
  const onClear = vi.fn();
  const onSetMode = vi.fn();
  render(
    <SearchBar
      inputRef={createRef<HTMLInputElement>()}
      query=""
      mode="broad"
      isMixed={false}
      onChange={onChange}
      onClear={onClear}
      onSetMode={onSetMode}
      activePage="atlas"
      scope={"atlas" as SearchScope}
      {...over}
    />,
  );
  return { onChange, onClear, onSetMode };
}

describe("SearchBar mode pills", () => {
  it("renders all three pills in atlas scope and presses the active one", () => {
    setup({ mode: "phrase" });
    const pills = screen.getAllByRole("button").filter((b) => b.classList.contains("mode-pill"));
    expect(pills).toHaveLength(3);
    expect(screen.getByText('"a"')).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("a*")).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onSetMode with the clicked mode", () => {
    const { onSetMode } = setup({ mode: "broad" });
    fireEvent.click(screen.getByText("Aa"));
    expect(onSetMode).toHaveBeenCalledWith("strict");
  });

  it("disables the pills and clears the pressed state when the query is mixed", () => {
    setup({ mode: "broad", isMixed: true });
    const broad = screen.getByText("a*");
    expect(broad).toBeDisabled();
    expect(broad).toHaveAttribute("aria-pressed", "false");
  });

  it("hides the mode pills outside the atlas scope", () => {
    setup({ scope: "radar" as SearchScope });
    expect(screen.queryByText("a*")).toBeNull();
  });
});

describe("SearchBar input controls", () => {
  it("hides the clear button when the query is empty and shows it when filled", () => {
    setup({ query: "" });
    expect(screen.getByLabelText("Clear search").className).toContain("invisible");
    cleanup();
    setup({ query: "vat" });
    expect(screen.getByLabelText("Clear search").className).not.toContain("invisible");
  });

  it("calls onClear when the clear button is clicked", () => {
    const { onClear } = setup({ query: "vat" });
    fireEvent.click(screen.getByLabelText("Clear search"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("shows the scope chip for non-atlas scopes", () => {
    setup({ scope: "reports" as SearchScope });
    expect(screen.getByText("reports")).toBeTruthy();
  });
});

describe("SearchBar recent searches dropdown", () => {
  function setupRecent(over: Partial<Parameters<typeof SearchBar>[0]> = {}) {
    const onRecentSelect = vi.fn();
    render(
      <SearchBar
        inputRef={createRef<HTMLInputElement>()}
        query=""
        mode="broad"
        isMixed={false}
        onChange={vi.fn()}
        onClear={vi.fn()}
        onSetMode={vi.fn()}
        activePage="atlas"
        scope={"atlas" as SearchScope}
        recentSearches={["vat", "jug", "pot", "dai"]}
        onRecentSelect={onRecentSelect}
        {...over}
      />,
    );
    return { onRecentSelect };
  }

  it("stays closed on the mount autofocus and opens on interaction", () => {
    setupRecent();
    // autoFocus fires once on mount — the dropdown must not open from it.
    expect(screen.queryByRole("listbox", { name: "Recent searches" })).toBeNull();
    fireEvent.pointerDown(screen.getByRole("searchbox"));
    expect(screen.getByRole("listbox", { name: "Recent searches" })).toBeTruthy();
  });

  it("hides shortly after blur", () => {
    vi.useFakeTimers();
    try {
      setupRecent();
      const input = screen.getByRole("searchbox");
      fireEvent.pointerDown(input);
      expect(screen.getByRole("listbox", { name: "Recent searches" })).toBeTruthy();
      fireEvent.blur(input);
      act(() => vi.runAllTimers()); // blur hides after a short delay (lets clicks land first)
      expect(screen.queryByRole("listbox", { name: "Recent searches" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows only the three most recent", () => {
    setupRecent();
    fireEvent.pointerDown(screen.getByRole("searchbox"));
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.queryByText("dai")).toBeNull();
  });

  it("hides when the typed term is a prefix of no recent", () => {
    setupRecent({ query: "amat" }); // none of vat/jug/pot/dai start with "amat"
    fireEvent.pointerDown(screen.getByRole("searchbox"));
    expect(screen.queryByRole("listbox", { name: "Recent searches" })).toBeNull();
  });

  it("narrows to recents that start with the typed term", () => {
    setupRecent({ query: "j", recentSearches: ["jug", "jar", "vat", "pot"] });
    fireEvent.pointerDown(screen.getByRole("searchbox"));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["jug", "jar"]);
  });

  it("matches the prefix case-insensitively and excludes the exact term", () => {
    setupRecent({ query: "VA", recentSearches: ["vat", "value", "jug"] });
    fireEvent.pointerDown(screen.getByRole("searchbox"));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["vat", "value"]);
  });

  it("treats the bare phrase/strict quote markers as empty", () => {
    for (const q of ['""', "''"]) {
      setupRecent({ query: q });
      fireEvent.pointerDown(screen.getByRole("searchbox"));
      expect(screen.getByRole("listbox", { name: "Recent searches" })).toBeTruthy();
      cleanup();
    }
  });

  it("re-summons the dropdown when Backspace is pressed on an empty field", () => {
    vi.useFakeTimers();
    try {
      setupRecent(); // query is ""
      const input = screen.getByRole("searchbox");
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
    const input = screen.getByRole("searchbox");
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(screen.queryByRole("listbox", { name: "Recent searches" })).toBeNull();
  });

  it("calls onRecentSelect with the chosen query and its rank", () => {
    const { onRecentSelect } = setupRecent();
    fireEvent.pointerDown(screen.getByRole("searchbox"));
    fireEvent.click(screen.getByText("jug"));
    expect(onRecentSelect).toHaveBeenCalledWith("jug", 1); // 0-based index in [vat, jug, pot]
  });

  it("renders nothing when there are no recents", () => {
    setupRecent({ recentSearches: [] });
    fireEvent.pointerDown(screen.getByRole("searchbox"));
    expect(screen.queryByRole("listbox", { name: "Recent searches" })).toBeNull();
  });
});
