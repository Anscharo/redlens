// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AtlasMarkdown, extractSources, balanceFences } from "./markdown";

afterEach(cleanup);

describe("extractSources", () => {
  it("returns an empty list when there are no atlas links", () => {
    expect(extractSources("plain text, no links")).toEqual([]);
  });

  it("extracts unique atlas doc links in order of appearance", () => {
    const content =
      "See [Doc One](/atlas/11111111-1111-1111-1111-111111111111) and " +
      "[Doc Two](/atlas/22222222-2222-2222-2222-222222222222), then " +
      "[Doc One again](/atlas/11111111-1111-1111-1111-111111111111).";
    expect(extractSources(content)).toEqual([
      { uuid: "11111111-1111-1111-1111-111111111111", title: "Doc One" },
      { uuid: "22222222-2222-2222-2222-222222222222", title: "Doc Two" },
    ]);
  });

  it("lowercases the extracted uuid", () => {
    const content = "[Title](/atlas/ABCDEF12-ABCD-ABCD-ABCD-ABCDEF123456)";
    expect(extractSources(content)[0].uuid).toBe("abcdef12-abcd-abcd-abcd-abcdef123456");
  });
});

describe("balanceFences", () => {
  it("leaves text with an even number of fences untouched", () => {
    const text = "before ```code``` after";
    expect(balanceFences(text)).toBe(text);
  });

  it("appends a synthetic closing fence when the count is odd", () => {
    const text = "before ```code still streaming";
    expect(balanceFences(text)).toBe("before ```code still streaming\n```");
  });

  it("treats text with no fences as balanced (zero is even)", () => {
    expect(balanceFences("no fences here")).toBe("no fences here");
  });
});

describe("AtlasMarkdown", () => {
  it("renders plain markdown content", () => {
    render(<AtlasMarkdown content="**bold** text" onAtlas={vi.fn()} />);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  it("intercepts atlas-uuid links and calls onAtlas instead of navigating", () => {
    const onAtlas = vi.fn();
    render(
      <AtlasMarkdown
        content="[Some Doc](/atlas/11111111-1111-1111-1111-111111111111)"
        onAtlas={onAtlas}
      />,
    );
    const link = screen.getByText("Some Doc");
    expect(link).toHaveAttribute("href", "/atlas?id=11111111-1111-1111-1111-111111111111");
    fireEvent.click(link);
    expect(onAtlas).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
  });

  it("renders non-atlas links as normal new-tab external links", () => {
    render(<AtlasMarkdown content="[External](https://example.com)" onAtlas={vi.fn()} />);
    const link = screen.getByText("External");
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders GFM tables via remark-gfm", () => {
    const content = "| A | B |\n| - | - |\n| 1 | 2 |";
    render(<AtlasMarkdown content={content} onAtlas={vi.fn()} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
