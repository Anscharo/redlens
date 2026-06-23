// @vitest-environment jsdom
// SearchBar header: the broad/phrase/strict mode pills (atlas scope only), the
// scope chip (non-atlas scopes), and the clear button. NavBar and Tooltip are
// stubbed so the test stays focused on SearchBar's own controls.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
