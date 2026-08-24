// @vitest-environment jsdom
// SwatchGrid's own job is small but easy to get backwards: decide, per token,
// whether a contrast badge can be computed at all (SWATCH_WORST_BG has no
// entry for every token) and pass isOverridden through from `draft` rather
// than from some other source of truth.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SwatchGrid } from "./SwatchGrid";
import type { PaletteToken } from "./palette-tokens";

afterEach(() => cleanup());

// "tan" has a SWATCH_WORST_BG entry ("surface"); "edge" does not — that split
// is what exercises both branches of SwatchGrid's contrastBadge computation.
const TOKENS: PaletteToken[] = [
  { name: "tan", label: "Tan", group: "text", alpha: false },
  { name: "edge", label: "Edge", group: "shadow", alpha: false },
];

function values(name: string) {
  return { tan: "#000000", surface: "#ffffff", edge: "#4488cc" }[name] ?? "#808080";
}

describe("SwatchGrid", () => {
  it("renders one swatch per token, labeled and valued via effectiveValue", () => {
    render(<SwatchGrid tokens={TOKENS} effectiveValue={values} draft={{}} onSwatchClick={() => {}} />);
    expect(screen.getByTitle("--tan: #000000")).toBeInTheDocument();
    expect(screen.getByTitle("--edge: #4488cc")).toBeInTheDocument();
  });

  it("computes a contrast badge only for a token with a SWATCH_WORST_BG entry", () => {
    render(<SwatchGrid tokens={TOKENS} effectiveValue={values} draft={{}} onSwatchClick={() => {}} />);
    // #000000 on #ffffff (tan's worst-case bg, "surface") is a real, badge-worthy pair.
    expect(screen.getByText(/Contrast: 21\.0/)).toBeInTheDocument();
    // "edge" has no SWATCH_WORST_BG entry, so no ratio can be computed for it.
    const edgeSwatch = screen.getByRole("button", { name: /Edge/ });
    expect(edgeSwatch.textContent).not.toMatch(/Contrast:/);
  });

  it("marks a token overridden only when its name is a key in draft", () => {
    render(
      <SwatchGrid tokens={TOKENS} effectiveValue={values} draft={{ tan: "#000000" }} onSwatchClick={() => {}} />,
    );
    const tanSwatch = screen.getByRole("button", { name: /Tan/ });
    const edgeSwatch = screen.getByRole("button", { name: /Edge/ });
    expect(tanSwatch.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(edgeSwatch.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("reports the clicked token's name to onSwatchClick", () => {
    const onSwatchClick = vi.fn();
    render(<SwatchGrid tokens={TOKENS} effectiveValue={values} draft={{}} onSwatchClick={onSwatchClick} />);
    fireEvent.click(screen.getByRole("button", { name: /Edge/ }));
    expect(onSwatchClick).toHaveBeenCalledWith("edge");
  });
});
