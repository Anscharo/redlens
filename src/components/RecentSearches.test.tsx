// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RecentSearches } from "./RecentSearches";
import type { RecentSuggestion } from "../lib/recentSearches";

afterEach(cleanup);

function setup(items: RecentSuggestion[], activeIndex = -1) {
  const onSelect = vi.fn();
  const onHover = vi.fn();
  render(
    <RecentSearches
      id="recent-search-listbox"
      items={items}
      activeIndex={activeIndex}
      onSelect={onSelect}
      onHover={onHover}
    />,
  );
  return { onSelect, onHover };
}

describe("RecentSearches", () => {
  it("renders the empty (no history) branch: listbox with no options", () => {
    setup([]);
    expect(screen.getByRole("listbox", { name: "Recent searches" })).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("renders each recent's query text and result count", () => {
    setup([{ q: "vat", n: 42 }, { q: "jug", n: 1 }]);
    expect(screen.getByText("vat")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByRole("option", { name: "vat, 42 results" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "jug, 1 result" })).toBeTruthy();
  });

  it("omits the count badge and uses the bare query as the label when n is undefined", () => {
    setup([{ q: "legacy", n: undefined }]);
    expect(screen.getByRole("option", { name: "legacy" })).toBeTruthy();
  });

  it("marks the active index as selected", () => {
    setup([{ q: "a", n: 1 }, { q: "b", n: 2 }], 1);
    const opts = screen.getAllByRole("option");
    expect(opts[0]).toHaveAttribute("aria-selected", "false");
    expect(opts[1]).toHaveAttribute("aria-selected", "true");
  });

  it("calls onSelect with the query and rank when clicked", () => {
    const { onSelect } = setup([{ q: "vat", n: 5 }, { q: "jug", n: 2 }]);
    fireEvent.click(screen.getByText("jug"));
    expect(onSelect).toHaveBeenCalledWith("jug", 1);
  });

  it("calls onHover with the rank on mouse move", () => {
    const { onHover } = setup([{ q: "vat", n: 5 }, { q: "jug", n: 2 }]);
    fireEvent.mouseMove(screen.getByText("jug"));
    expect(onHover).toHaveBeenCalledWith(1);
  });

  it("prevents default on mousedown so the click lands before the input blurs", () => {
    setup([{ q: "vat", n: 5 }]);
    const button = screen.getByText("vat").closest("button")!;
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("clears the active row when clicking away is simulated (activeIndex -1 selects none)", () => {
    setup([{ q: "vat", n: 5 }], -1);
    expect(screen.getByRole("option")).toHaveAttribute("aria-selected", "false");
  });
});
