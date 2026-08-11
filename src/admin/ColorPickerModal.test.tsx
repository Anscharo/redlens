// @vitest-environment jsdom
// The wheel/shade/alpha widgets are real @uiw/react-color components here —
// none of these tests drag them, so no mocking is needed. What's under test
// is ColorPickerModal's own glue: the dialog chrome, cancel paths, and the
// text field's commitText parser.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ColorPickerModal } from "./ColorPickerModal";
import type { PaletteToken } from "./palette-tokens";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("style");
});

const TOKEN: PaletteToken = { name: "accent", label: "Accent", group: "brand", alpha: false };

describe("ColorPickerModal — chrome", () => {
  it("renders a labeled dialog with the token name and initial value in the text field", () => {
    render(<ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={() => {}} onConfirm={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Edit Accent" })).toBeInTheDocument();
    expect(screen.getByText("--accent")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("#111111");
  });

  it("cancels on a click outside the panel (the backdrop)", () => {
    const onCancel = vi.fn();
    render(<ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={onCancel} onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not cancel on a click inside the panel", () => {
    const onCancel = vi.fn();
    render(<ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={onCancel} onConfirm={() => {}} />);
    fireEvent.click(screen.getByText("Accent"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on the Escape key", () => {
    const onCancel = vi.fn();
    render(<ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={onCancel} onConfirm={() => {}} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels via the cancel button", () => {
    const onCancel = vi.fn();
    render(<ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={onCancel} onConfirm={() => {}} />);
    fireEvent.click(screen.getByText("cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("confirms the current color via the done button", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={() => {}} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("done"));
    expect(onConfirm).toHaveBeenCalledWith("#111111");
  });

  it("confirms on Enter in the text field", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={() => {}} onConfirm={onConfirm} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledWith("#111111");
  });

  it("a non-Enter key in the text field does not confirm", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={() => {}} onConfirm={onConfirm} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Tab" });
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("ColorPickerModal — text field (commitText)", () => {
  it("live-previews a valid typed hex value on the document root", () => {
    render(<ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={() => {}} onConfirm={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "#4488cc" } });
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#4488cc");
    expect(screen.getByRole("textbox")).toHaveValue("#4488cc");
  });

  it("echoes an unparsable value in the field but leaves the live preview untouched", () => {
    render(<ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={() => {}} onConfirm={() => {}} />);
    // A bare "#" has no hex digits to parse — hexToHsva throws, and commitText
    // swallows it so the user can keep typing without the preview flashing.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "#" } });
    expect(screen.getByRole("textbox")).toHaveValue("#");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("");
  });

  it("clearing the field updates the input but does not touch the live preview", () => {
    render(<ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={() => {}} onConfirm={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "#4488cc" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#4488cc");
  });

  const ALPHA_TOKEN: PaletteToken = { name: "row-hover", label: "Row Hover", group: "row", alpha: true };

  it("also live-previews a valid typed rgba() value, for an alpha-enabled token", () => {
    render(
      <ColorPickerModal token={ALPHA_TOKEN} initialValue="rgba(10, 20, 30, 1)" onCancel={() => {}} onConfirm={() => {}} />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "rgba(40, 50, 60, 0.5)" } });
    expect(document.documentElement.style.getPropertyValue("--row-hover")).toBe("rgba(40, 50, 60, 0.5)");
    expect(screen.getByRole("textbox")).toHaveValue("rgba(40, 50, 60, 0.5)");
  });

  it("accepts the alpha-less rgb() function form too", () => {
    render(
      <ColorPickerModal token={ALPHA_TOKEN} initialValue="rgba(10, 20, 30, 1)" onCancel={() => {}} onConfirm={() => {}} />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "rgb(1, 2, 3)" } });
    expect(document.documentElement.style.getPropertyValue("--row-hover")).toBe("rgb(1, 2, 3)");
  });

  it("silently ignores a value matching neither hex nor rgb()/rgba(), without touching the live preview", () => {
    render(<ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={() => {}} onConfirm={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "notacolor" } });
    expect(screen.getByRole("textbox")).toHaveValue("notacolor");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("");
  });
});
