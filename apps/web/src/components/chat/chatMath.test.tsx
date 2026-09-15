// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AtlasMarkdown } from "./markdown";
import { closeOpenMathFence } from "./chatMath";

afterEach(cleanup);

// useMathPlugins caches the assembled KaTeX plugin arrays at MODULE scope but
// tracks readiness in per-component state. This file owns the ordering that
// pulls those two apart, so it must be the first thing here to render math —
// once any test in this file loads KaTeX, every later mount reads the
// populated cache in useState and the case under test can't happen.
describe("useMathPlugins — a math-free mount that gains math after someone else loaded KaTeX", () => {
  it("renders the math rather than raw $$", async () => {
    // A: mounts before any KaTeX load, with no math in its content.
    const a = render(<AtlasMarkdown content="A plain answer, no formulas yet." onAtlas={vi.fn()} />);
    expect(await screen.findByText("A plain answer, no formulas yet.")).toBeInTheDocument();

    // B: a different instance triggers the load and populates the cache.
    const b = render(<AtlasMarkdown content={"$$\nx^2 + y^2\n$$"} onAtlas={vi.fn()} />);
    await waitFor(() => expect(b.container.querySelector(".katex-display")).toBeInTheDocument());

    // A now streams math in. Its effect re-runs, but the module cache is
    // already populated — a guard on the cache (rather than on A's own
    // katexReady) would short-circuit and leave A rendering literal $$.
    a.rerender(<AtlasMarkdown content={"Now a formula:\n\n$$\nx^2 + y^2\n$$"} onAtlas={vi.fn()} />);
    await waitFor(() => expect(a.container.querySelector(".katex-display")).toBeInTheDocument());
    expect(a.container.textContent).not.toContain("$$");
  });
});

describe("closeOpenMathFence", () => {
  it("leaves a balanced buffer alone", () => {
    const text = "Before.\n\n$$\nx^2\n$$\n\nAfter.";
    expect(closeOpenMathFence(text)).toBe(text);
  });

  it("closes at the first paragraph break after the open $$, not at the end", () => {
    expect(closeOpenMathFence("Intro.\n\n$$\nx^2\n\nProse that streamed in after.")).toBe(
      "Intro.\n\n$$\nx^2\n$$\n\nProse that streamed in after.",
    );
  });

  it("falls back to the end of the buffer while still mid-formula", () => {
    expect(closeOpenMathFence("Intro.\n\n$$\nx^2 + \\frac{1}{y")).toBe("Intro.\n\n$$\nx^2 + \\frac{1}{y\n$$");
  });

  it("leaves text with no math delimiters untouched", () => {
    expect(closeOpenMathFence("Just prose.")).toBe("Just prose.");
  });
});
