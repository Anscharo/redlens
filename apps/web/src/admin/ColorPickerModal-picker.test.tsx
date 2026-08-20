// @vitest-environment jsdom
// The real Wheel/ShadeSlider/Alpha widgets from @uiw/react-color are
// pointer/canvas-driven and not something jsdom can meaningfully drag, so
// they're replaced with buttons that fire the same onChange shape. That
// keeps the assertions about ColorPickerModal's own wiring — live preview,
// text sync, and the mount/unmount inline-style contract — independent of
// @uiw's pointer math (verified separately against the real conversion
// functions, which are NOT mocked here).
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PaletteToken } from "./palette-tokens";

vi.mock("@uiw/react-color", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uiw/react-color")>();
  return {
    ...actual,
    Wheel: ({ onChange }: { onChange: (c: { hsva: { h: number; s: number } }) => void }) => (
      <button aria-label="fake-wheel" onClick={() => onChange({ hsva: { h: 200, s: 60 } })} />
    ),
    ShadeSlider: ({ onChange }: { onChange: (s: { v: number }) => void }) => (
      <button aria-label="fake-shade" onClick={() => onChange({ v: 40 })} />
    ),
    Alpha: ({ onChange }: { onChange: (a: { a: number }) => void }) => (
      <button aria-label="fake-alpha" onClick={() => onChange({ a: 0.5 })} />
    ),
  };
});

import { ColorPickerModal } from "./ColorPickerModal";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("style");
});

const TOKEN: PaletteToken = { name: "accent", label: "Accent", group: "brand", alpha: false };
const ALPHA_TOKEN: PaletteToken = { name: "row-hover", label: "Row Hover", group: "row", alpha: true };

describe("ColorPickerModal — wheel/shade wiring", () => {
  it("Wheel onChange live-previews the new hue/saturation, keeping the parsed value/alpha", () => {
    render(<ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={() => {}} onConfirm={() => {}} />);
    fireEvent.click(screen.getByLabelText("fake-wheel"));
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#070e11");
    expect(screen.getByRole("textbox")).toHaveValue("#070e11");
  });

  it("ShadeSlider onChange merges onto the color the wheel already set", () => {
    render(<ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={() => {}} onConfirm={() => {}} />);
    fireEvent.click(screen.getByLabelText("fake-wheel"));
    fireEvent.click(screen.getByLabelText("fake-shade"));
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#295266");
  });
});

describe("ColorPickerModal — alpha channel", () => {
  it("renders the Alpha slider only for an alpha-enabled token", () => {
    render(<ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={() => {}} onConfirm={() => {}} />);
    expect(screen.queryByLabelText("fake-alpha")).toBeNull();
  });

  it("Alpha onChange updates only the alpha channel of an rgba() value", () => {
    render(
      <ColorPickerModal
        token={ALPHA_TOKEN}
        initialValue="rgba(10, 20, 30, 1)"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByLabelText("fake-alpha")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("fake-alpha"));
    expect(document.documentElement.style.getPropertyValue("--row-hover")).toBe("rgba(10, 20, 30, 0.5)");
  });
});

describe("ColorPickerModal — mount/unmount inline-style contract", () => {
  it("restores the pre-open inline value when closed without confirming", () => {
    // The pre-open inline value matches what PalettePage actually passes as
    // initialValue (effectiveValue(token.name)) — a prior override already live.
    document.documentElement.style.setProperty("--accent", "#111111");
    const { unmount } = render(
      <ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={() => {}} onConfirm={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText("fake-wheel"));
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#070e11");

    unmount();
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#111111");
  });

  it("removes the property entirely (rather than leaving the preview) when there was no prior inline value", () => {
    const { unmount } = render(
      <ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={() => {}} onConfirm={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText("fake-wheel"));
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#070e11");

    unmount();
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("");
    expect(document.documentElement.style.cssText).not.toContain("--accent");
  });

  it("keeps the live-previewed value in place after confirming (parent owns committing it to the draft)", () => {
    const onConfirm = vi.fn();
    const { unmount } = render(
      <ColorPickerModal token={TOKEN} initialValue="#111111" onCancel={() => {}} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByLabelText("fake-wheel"));
    fireEvent.click(screen.getByText("done"));
    expect(onConfirm).toHaveBeenCalledWith("#070e11");

    unmount();
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#070e11");
  });
});
