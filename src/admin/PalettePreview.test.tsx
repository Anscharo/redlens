// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PalettePreview } from "./PalettePreview";
import { PALETTE_TOKENS } from "./palette-tokens";

afterEach(() => cleanup());

describe("PalettePreview", () => {
  it("renders the doc-tree sample rows, entity labels, and status pills", () => {
    render(<PalettePreview effectiveValue={(name) => `var-${name}`} />);
    expect(screen.getByText("Core — Accessibility Scope")).toBeInTheDocument();
    expect(screen.getByText("Instance")).toBeInTheDocument();
    expect(screen.getByText("Facilitator")).toBeInTheDocument();
    expect(screen.getByText("Aligned Delegate")).toBeInTheDocument();
    expect(screen.getByText("update available")).toBeInTheDocument();
    expect(screen.getByText("no network")).toBeInTheDocument();
    expect(screen.getByText("highlighted term")).toBeInTheDocument();
  });

  it("exposes every palette token as a CSS variable on the preview container", () => {
    render(<PalettePreview effectiveValue={(name) => `var-${name}`} />);
    // The section's direct-child div is the one carrying the full previewVars map.
    const section = screen.getByRole("heading", { name: "Live Preview" }).closest("section")!;
    const wrapper = section.querySelector(":scope > div") as HTMLElement;
    expect(wrapper.style.getPropertyValue(`--${PALETTE_TOKENS[0].name}`)).toBe(`var-${PALETTE_TOKENS[0].name}`);
    expect(
      wrapper.style.getPropertyValue(`--${PALETTE_TOKENS[PALETTE_TOKENS.length - 1].name}`),
    ).toBe(`var-${PALETTE_TOKENS[PALETTE_TOKENS.length - 1].name}`);
  });
});
