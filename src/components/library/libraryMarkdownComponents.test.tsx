// @vitest-environment jsdom
// Direct unit tests for buildComponents' `code` renderer's children-shape
// fallback — react-markdown virtually always hands a single string child to
// an inline code span, so the array-of-children path (a code span split
// into multiple text/inline nodes) is exercised here by calling the
// component function directly rather than contriving markdown source for it.
import type { ReactElement } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { buildComponents } from "./libraryMarkdownComponents";

afterEach(cleanup);

type CodeFn = (p: { children: unknown }) => ReactElement;

describe("buildComponents().code — children shape fallback", () => {
  it("joins array-of-strings children before checking for a full uuid", () => {
    const uuid = "55999acf-75fe-4adf-8584-9746ef50d3e4";
    const parts = [uuid.slice(0, 20), uuid.slice(20)];
    const Code = buildComponents(null).code as CodeFn;
    render(<Code children={parts} />);
    const link = screen.getByRole("link", { name: "55999acf" });
    expect(link).toHaveAttribute("href", expect.stringContaining(uuid));
  });

  it("falls back to plain code for non-string, non-array children", () => {
    const Code = buildComponents(null).code as CodeFn;
    const { container } = render(<Code children={undefined} />);
    const code = container.querySelector("code");
    expect(code).toBeInTheDocument();
    expect(code).toBeEmptyDOMElement();
  });
});
