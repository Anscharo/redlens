// @vitest-environment jsdom
// The color-picker modal only mounts once a swatch is clicked — these tests
// never click one, so they exercise PalettePage's own structure and the
// apply/reset/copy button gating without needing to touch @uiw/react-color.
//
// Nothing here loads a stylesheet, so every token's cssDefault() resolves to
// "" (unset) and gets cached that way for the rest of this file — the depth
// "copy pattern" test needs real, distinguishable defaults, so it lives in
// its own file (PalettePage-depth.test.tsx) where it can prime the cache
// first.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PalettePage } from "./PalettePage";
import { GROUP_LABEL } from "./palette-tokens";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("style");
});

describe("PalettePage — structure", () => {
  it("renders every semantic group heading plus the depth, contrast, and preview sections", () => {
    render(<PalettePage />);
    for (const label of ["Surface", "Brand", "Text", "Row Overlays", "Shadows", "Graph Chrome", "Diff", "Entity Types"]) {
      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: GROUP_LABEL.depth })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Contrast Audit" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Live Preview" })).toBeInTheDocument();
  });

  it("starts with apply, reset, and copy-as-css all disabled, and no color picker open", () => {
    render(<PalettePage />);
    expect(screen.getByRole("button", { name: "apply" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "reset" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "copy as css" })).toBeDisabled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
