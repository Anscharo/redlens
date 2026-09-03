// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SparkMark, PinIcon, GitHubMark, GoogleMark, DockRightIcon, FloatIcon, SendIcon, ThemeGlyph } from "./glyphs";

afterEach(cleanup);

describe("chat glyphs", () => {
  it("renders SparkMark with the requested font size", () => {
    const { container } = render(<SparkMark size={20} />);
    const span = container.querySelector("span.rlc-spark");
    expect(span).toBeTruthy();
    expect(span).toHaveStyle({ fontSize: "20px" });
    expect(span).toHaveAttribute("aria-hidden", "true");
  });

  it("renders SparkMark with the default size when omitted", () => {
    const { container } = render(<SparkMark />);
    expect(container.querySelector("span.rlc-spark")).toHaveStyle({ fontSize: "14px" });
  });

  it.each([
    ["PinIcon", PinIcon],
    ["GitHubMark", GitHubMark],
    ["GoogleMark", GoogleMark],
    ["DockRightIcon", DockRightIcon],
    ["FloatIcon", FloatIcon],
    ["SendIcon", SendIcon],
  ] as const)("renders %s as an svg with the given size", (_name, Glyph) => {
    const { container } = render(<Glyph size={22} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg).toHaveAttribute("width", "22");
    expect(svg).toHaveAttribute("height", "22");
  });

  it("defaults each svg glyph's size when omitted", () => {
    const { container } = render(<SendIcon />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "15");
  });

  it("renders ThemeGlyph as an svg with the given size and a glyph mark per theme", () => {
    const { container, rerender } = render(<ThemeGlyph theme="dark" size={22} />);
    const svg = () => container.querySelector("svg");
    expect(svg()).toHaveAttribute("width", "22");
    expect(svg()).toHaveAttribute("data-glyph", "moon");
    rerender(<ThemeGlyph theme="light" size={22} />);
    expect(svg()).toHaveAttribute("data-glyph", "sun");
    rerender(<ThemeGlyph theme="giedi" size={22} />);
    expect(svg()).toHaveAttribute("data-glyph", "eclipse");
  });
});
