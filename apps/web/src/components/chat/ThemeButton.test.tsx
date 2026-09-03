// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ThemeButton } from "./ThemeButton";
import { THEMES, THEME_KEY } from "../../lib/theme";

function glyph(): string | null {
  return screen.getByRole("button", { name: "Colour scheme" }).querySelector("[data-glyph]")?.getAttribute("data-glyph") ?? null;
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

describe("ThemeButton", () => {
  it("opens the picker from the trigger", () => {
    render(<ThemeButton />);
    const trigger = screen.getByRole("button", { name: "Colour scheme" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(glyph()).toMatch(/^(sun|moon|eclipse)$/);
    expect(screen.queryByRole("radiogroup", { name: "Theme" })).toBeNull();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("data-state", "open");
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(THEMES.length);
  });

  it("swaps the glyph per theme id and keeps the picker open", () => {
    render(<ThemeButton />);
    fireEvent.click(screen.getByRole("button", { name: "Colour scheme" }));

    fireEvent.click(screen.getByText("Dark").closest("button")!);
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(glyph()).toBe("moon");
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Light").closest("button")!);
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    expect(glyph()).toBe("sun");
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Giedi").closest("button")!);
    expect(localStorage.getItem(THEME_KEY)).toBe("giedi");
    expect(glyph()).toBe("eclipse");
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
  });

  it("closes on outside click and on Escape", () => {
    render(
      <div>
        <ThemeButton />
        <div data-testid="outside" />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Colour scheme" }));
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("radiogroup", { name: "Theme" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Colour scheme" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("radiogroup", { name: "Theme" })).toBeNull();
  });
});
