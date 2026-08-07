// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ColorPickerModal } from "./ColorPickerModal";
import type { PaletteToken } from "./palette-tokens";

const HEX_TOKEN: PaletteToken = { name: "accent", label: "Accent", group: "brand", alpha: false };
const ALPHA_TOKEN: PaletteToken = { name: "shadow-strong", label: "Shadow", group: "surface", alpha: true };

const liveValue = (name: string) => document.documentElement.style.getPropertyValue(`--${name}`);

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("style");
});

describe("ColorPickerModal", () => {
  it("renders inside the shared modal shell, labelled by the token", () => {
    render(<ColorPickerModal token={HEX_TOKEN} initialValue="#c67267" onCancel={() => {}} onConfirm={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "Edit Accent");
    expect(screen.getByText("--accent")).toBeInTheDocument();
  });

  it("focuses and selects the text input on mount", () => {
    render(<ColorPickerModal token={HEX_TOKEN} initialValue="#c67267" onCancel={() => {}} onConfirm={() => {}} />);
    const input = screen.getByDisplayValue("#c67267") as HTMLInputElement;
    expect(input).toHaveFocus();
    // The shell focuses it; this component additionally selects the text.
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("#c67267".length);
  });

  it("live-previews a typed hex value on the document element", () => {
    render(<ColorPickerModal token={HEX_TOKEN} initialValue="#c67267" onCancel={() => {}} onConfirm={() => {}} />);
    fireEvent.change(screen.getByDisplayValue("#c67267"), { target: { value: "#123456" } });
    expect(liveValue("accent")).toBe("#123456");
  });

  it("live-previews a typed rgba value", () => {
    render(<ColorPickerModal token={ALPHA_TOKEN} initialValue="rgba(0, 0, 0, 0.5)" onCancel={() => {}} onConfirm={() => {}} />);
    fireEvent.change(screen.getByDisplayValue("rgba(0, 0, 0, 0.5)"), {
      target: { value: "rgba(10, 20, 30, 0.25)" },
    });
    expect(liveValue("shadow-strong")).toBe("rgba(10, 20, 30, 0.25)");
  });

  it("ignores unparseable input while typing instead of throwing", () => {
    render(<ColorPickerModal token={HEX_TOKEN} initialValue="#c67267" onCancel={() => {}} onConfirm={() => {}} />);
    const input = screen.getByDisplayValue("#c67267");
    expect(() => fireEvent.change(input, { target: { value: "#zz" } })).not.toThrow();
    expect(() => fireEvent.change(input, { target: { value: "" } })).not.toThrow();
    expect(screen.getByDisplayValue("")).toBeInTheDocument();
  });

  it("falls back to black for an initial value it cannot parse", () => {
    render(<ColorPickerModal token={HEX_TOKEN} initialValue="not-a-color" onCancel={() => {}} onConfirm={() => {}} />);
    const onConfirm = vi.fn();
    cleanup();
    render(<ColorPickerModal token={HEX_TOKEN} initialValue="nonsense" onCancel={() => {}} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("done"));
    expect(onConfirm).toHaveBeenCalledWith("#000000");
  });

  it("confirms on the done button with the serialized value", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal token={HEX_TOKEN} initialValue="#123456" onCancel={() => {}} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("done"));
    expect(onConfirm).toHaveBeenCalledWith("#123456");
  });

  it("serializes an alpha token as rgba", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal token={ALPHA_TOKEN} initialValue="rgba(255, 0, 0, 0.5)" onCancel={() => {}} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("done"));
    expect(onConfirm).toHaveBeenCalledWith("rgba(255, 0, 0, 0.5)");
  });

  it("confirms on Enter in the text input", () => {
    const onConfirm = vi.fn();
    render(<ColorPickerModal token={HEX_TOKEN} initialValue="#123456" onCancel={() => {}} onConfirm={onConfirm} />);
    fireEvent.keyDown(screen.getByDisplayValue("#123456"), { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledWith("#123456");
  });

  it("cancels on the cancel button and via the shell's Escape handler", () => {
    const onCancel = vi.fn();
    render(<ColorPickerModal token={HEX_TOKEN} initialValue="#c67267" onCancel={onCancel} onConfirm={() => {}} />);
    fireEvent.click(screen.getByText("cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  // ShadeSlider and Alpha are @uiw/react-color's keyboard-accessible
  // Interactive surfaces (ShadeSlider is built on Alpha, hence the shared
  // .w-color-alpha class). Driving them with arrow keys exercises the same
  // onChange → updateHsva → serialize → setLive path a drag would, without
  // depending on pointer geometry that jsdom reports as 0×0. The Wheel has no
  // keyboard affordance at all, so it stays pointer-only and unreachable here.
  //
  // The widget no-ops unless the value actually moves, so direction matters
  // and differs per slider: ShadeSlider drives its inner Alpha with
  // `a: 1 - hsva.v / 100`, so a full-value colour sits at 0 and must go RIGHT,
  // while the real alpha slider sits at 1 and must go LEFT.
  const inputValue = () => (screen.getByRole("textbox") as HTMLInputElement).value;

  it("live-previews a shade-slider change driven by keyboard", () => {
    render(<ColorPickerModal token={ALPHA_TOKEN} initialValue="rgba(255, 0, 0, 1)" onCancel={() => {}} onConfirm={() => {}} />);
    const shade = document.querySelector(".w-color-saturation .w-color-interactive")!;
    const before = inputValue();

    fireEvent.keyDown(shade, { key: "ArrowRight" });

    expect(inputValue()).not.toBe(before);
    expect(liveValue("shadow-strong")).toBe(inputValue());
  });

  it("live-previews an alpha change driven by keyboard", () => {
    render(<ColorPickerModal token={ALPHA_TOKEN} initialValue="rgba(255, 0, 0, 1)" onCancel={() => {}} onConfirm={() => {}} />);
    // The alpha slider is the .w-color-alpha that is NOT the shade slider.
    const alpha = [...document.querySelectorAll(".w-color-alpha")]
      .find((el) => !el.classList.contains("w-color-saturation"))!
      .querySelector(".w-color-interactive")!;

    fireEvent.keyDown(alpha, { key: "ArrowLeft" });

    // Alpha steps by 1%, and an alpha token serializes as rgba(...).
    expect(inputValue()).toMatch(/^rgba\(.*0\.99\)$/);
    expect(liveValue("shadow-strong")).toBe(inputValue());
  });

  it("hides the alpha slider for a token that does not support alpha", () => {
    render(<ColorPickerModal token={HEX_TOKEN} initialValue="#c67267" onCancel={() => {}} onConfirm={() => {}} />);
    expect(document.querySelectorAll(".w-color-interactive")).toHaveLength(2);
  });

  // The live preview writes straight to documentElement, so unmounting without
  // confirming has to put back whatever was there before the modal opened.
  it("restores the pre-open inline value when closed without confirming", () => {
    document.documentElement.style.setProperty("--accent", "#original");
    const { unmount } = render(
      <ColorPickerModal token={HEX_TOKEN} initialValue="#c67267" onCancel={() => {}} onConfirm={() => {}} />,
    );
    fireEvent.change(screen.getByDisplayValue("#c67267"), { target: { value: "#123456" } });
    expect(liveValue("accent")).toBe("#123456");

    unmount();
    expect(liveValue("accent")).toBe("#original");
  });

  it("removes the inline value on cancel when there was none before opening", () => {
    const { unmount } = render(
      <ColorPickerModal token={HEX_TOKEN} initialValue="#c67267" onCancel={() => {}} onConfirm={() => {}} />,
    );
    fireEvent.change(screen.getByDisplayValue("#c67267"), { target: { value: "#123456" } });
    unmount();
    expect(liveValue("accent")).toBe("");
  });

  // Confirming is the one path that must NOT roll back — the parent commits
  // the live-previewed value to the draft palette.
  it("leaves the previewed value in place after confirming", () => {
    document.documentElement.style.setProperty("--accent", "#original");
    const { unmount } = render(
      <ColorPickerModal token={HEX_TOKEN} initialValue="#c67267" onCancel={() => {}} onConfirm={() => {}} />,
    );
    fireEvent.change(screen.getByDisplayValue("#c67267"), { target: { value: "#123456" } });
    fireEvent.click(screen.getByText("done"));
    unmount();
    expect(liveValue("accent")).toBe("#123456");
  });
});
