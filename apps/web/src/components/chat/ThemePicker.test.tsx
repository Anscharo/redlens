// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemePicker } from "./ThemePicker";
import { THEMES, THEME_KEY, DEFAULT_THEME } from "../../lib/theme";

// The picker is a roving-tabindex radiogroup, and its keyboard half is the part
// nothing else exercises: ThemeButton renders it, but does not drive arrow keys.
// Without these, ThemePicker's handleKeyDown is dead weight in coverage terms
// and — more to the point — a broken arrow key would only ever be found by
// someone navigating the menu without a mouse.

function rows(): HTMLElement[] {
  return screen.getAllByRole("radio");
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-scheme");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ThemePicker", () => {
  it("keeps a checkmark on the selected row and a glyph on the others", () => {
    render(<ThemePicker />);
    for (const t of THEMES) {
      const row = screen.getByText(t.label).closest("button")!;
      const mark = row.querySelector(".rlc-theme-mark");
      expect(mark).toBeTruthy();
      if (t.id === DEFAULT_THEME) {
        expect(mark!.textContent).toBe("✓");
        expect(mark!.querySelector("[data-glyph]")).toBeNull();
      } else {
        expect(mark!.textContent).toBe("");
        expect(mark!.querySelector("[data-glyph]")).toBeTruthy();
      }
    }
  });

  // Roving tabindex: exactly one row is tabbable, and it is the selected one —
  // otherwise tabbing through the menu would stop on every theme in the list.
  it("keeps exactly one row in the tab order, the checked one", () => {
    render(<ThemePicker />);
    const tabbable = rows().filter((r) => r.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0].getAttribute("aria-checked")).toBe("true");
    expect(tabbable[0].textContent).toContain(
      THEMES.find((t) => t.id === DEFAULT_THEME)!.label,
    );
  });

  it("selects a theme on click and persists it", async () => {
    const user = userEvent.setup();
    render(<ThemePicker />);
    const target = THEMES.find((t) => t.id !== DEFAULT_THEME)!;

    await user.click(screen.getByText(target.label).closest("button")!);

    expect(localStorage.getItem(THEME_KEY)).toBe(target.id);
    expect(document.documentElement.getAttribute("data-theme")).toBe(target.id);
  });

  it.each([
    { key: "{ArrowDown}", delta: 1 },
    { key: "{ArrowRight}", delta: 1 },
    { key: "{ArrowUp}", delta: -1 },
    { key: "{ArrowLeft}", delta: -1 },
  ])("moves selection with $key", async ({ key, delta }) => {
    const user = userEvent.setup();
    render(<ThemePicker />);
    const from = THEMES.findIndex((t) => t.id === DEFAULT_THEME);
    act(() => rows()[from].focus());

    await user.keyboard(key);

    // Both axes are wired on purpose: a radiogroup rendered as a vertical list
    // is still expected to answer Left/Right by the ARIA pattern.
    const expected = THEMES[(from + delta + THEMES.length) % THEMES.length];
    expect(localStorage.getItem(THEME_KEY)).toBe(expected.id);
    expect(document.activeElement).toBe(rows()[THEMES.indexOf(expected)]);
  });

  it("wraps around at both ends", async () => {
    const user = userEvent.setup();
    render(<ThemePicker />);
    act(() => rows()[0].focus());

    await user.keyboard("{ArrowUp}");
    expect(localStorage.getItem(THEME_KEY)).toBe(THEMES[THEMES.length - 1].id);

    act(() => rows()[THEMES.length - 1].focus());
    await user.keyboard("{ArrowDown}");
    expect(localStorage.getItem(THEME_KEY)).toBe(THEMES[0].id);
  });

  it("ignores keys it does not own, so the menu's own handling still works", async () => {
    const user = userEvent.setup();
    render(<ThemePicker />);
    act(() => rows()[0].focus());

    await user.keyboard("{Escape}");
    await user.keyboard("a");

    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });
});
