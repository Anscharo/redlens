// @vitest-environment jsdom
// The full click-a-swatch → edit → confirm → apply/reset loop, driven
// through the real ColorPickerModal via its text field (proven safe to mount
// unmocked in ColorPickerModal.test.tsx) rather than the wheel/shade canvas
// widgets.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PalettePage } from "./PalettePage";
import { readOverrides } from "./palette-storage";

function openBackgroundPicker() {
  fireEvent.click(screen.getByRole("button", { name: /^Edit Background/ }));
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  vi.restoreAllMocks();
});

describe("PalettePage — swatch editing", () => {
  it("opens the picker for the clicked token, labeled with that token's name", () => {
    render(<PalettePage />);
    openBackgroundPicker();
    expect(screen.getByRole("dialog", { name: "Edit Background" })).toBeInTheDocument();
  });

  it("confirming a new value updates the swatch and enables apply", () => {
    render(<PalettePage />);
    openBackgroundPicker();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "#4488cc" } });
    fireEvent.click(screen.getByText("done"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTitle("--bg: #4488cc")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "apply" })).toBeEnabled();
    expect(screen.getByText("unsaved changes")).toBeInTheDocument();
  });

  it("Escape closes the picker without changing the swatch or dirtying apply", () => {
    render(<PalettePage />);
    openBackgroundPicker();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "#4488cc" } });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    // No override dot on the swatch — the typed value never got committed to the draft.
    expect(screen.getByRole("button", { name: /^Edit Background/ }).querySelector('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByRole("button", { name: "apply" })).toBeDisabled();
  });

  it("apply persists the edit to localStorage and the live DOM; reset reverses both", () => {
    render(<PalettePage />);
    openBackgroundPicker();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "#4488cc" } });
    fireEvent.click(screen.getByText("done"));

    fireEvent.click(screen.getByRole("button", { name: "apply" }));
    expect(readOverrides()).toEqual({ bg: "#4488cc" });
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#4488cc");
    expect(screen.getByRole("button", { name: "apply" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "reset" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    expect(readOverrides()).toEqual({});
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("");
    expect(screen.getByRole("button", { name: /^Edit Background/ }).querySelector('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByRole("button", { name: "reset" })).toBeDisabled();
  });
});

describe("PalettePage — copy as css", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes the snippet to the clipboard and flashes 'copied' for 1.5s", async () => {
    render(<PalettePage />);
    openBackgroundPicker();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "#4488cc" } });
    fireEvent.click(screen.getByText("done"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "copy as css" }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect((navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("--bg: #4488cc;");
    expect(screen.getByText("copied")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.queryByText("copied")).toBeNull();
  });
});
