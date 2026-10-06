// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MscAtlasGap } from "./MscAtlasGap";

describe("MscAtlasGap", () => {
  it("gives the Atlas figure before penalties and the most it differs, linked to its steps", () => {
    render(<MscAtlasGap due={{ soter: 10_000_000, atlas: 8_500_000, gap: 1_500_000 }} />);
    expect(screen.getByText(/up to \$1\.50M less than Soter/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Stage 1 formula" })).toHaveAttribute("href", expect.stringContaining("2617edae"));
    expect(screen.getByRole("link", { name: "penalties" })).toHaveAttribute("href", expect.stringContaining("a9427e1a"));
  });

  it("drops the links inside a link of its own, and says nothing when the two agree", () => {
    const { container, rerender } = render(<MscAtlasGap due={{ soter: 10, atlas: 4, gap: 6 }} plain />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toMatch(/up to \$6 less to Sky, before penalties/);
    rerender(<MscAtlasGap due={{ soter: 10, atlas: 10, gap: 0 }} />);
    expect(container.textContent).toBe("");
  });
});
