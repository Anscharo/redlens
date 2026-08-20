// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CrossViewToc } from "./CrossViewToc";
import { extractHeadings } from "../../lib/crossviewHeadings";
import conceptsRaw from "../../../../../docs/crossview/concepts.md?raw";

describe("CrossViewToc", () => {
  it("renders a nav landmark with one entry per h2/h3 heading, hrefs matching the extracted slugs", () => {
    render(<CrossViewToc />);
    const nav = screen.getByRole("navigation", { name: "Concepts contents" });
    const headings = extractHeadings(conceptsRaw);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(headings.length);
    expect(links[0]).toHaveAttribute("href", `#${headings[0].slug}`);
    expect(nav).toContainElement(links[0]);
  });

  it("indents h3 entries under their h2 (a distinguishing class), unlike h2 entries", () => {
    render(<CrossViewToc />);
    const headings = extractHeadings(conceptsRaw);
    const firstH3Index = headings.findIndex((h) => h.level === 3);
    const links = screen.getAllByRole("link");
    const h3Item = links[firstH3Index].closest("li");
    const h2Item = links[0].closest("li");
    expect(h3Item?.className).toContain("pl-3");
    expect(h2Item?.className ?? "").not.toContain("pl-3");
  });
});
