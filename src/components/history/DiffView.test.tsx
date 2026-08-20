// @vitest-environment jsdom
// DiffView renders a stored diff payload: plain =/+/- rows, the "…" gap marker,
// and word-level "~" intraline rows. It also runs the display-only
// refineProseDiff transform (a memoized call) over the lines before rendering,
// so a heavily rewritten paragraph promotes to clean whole-line swaps. These
// cases pin both the raw render branches and that the component renders the
// REFINED output, not the raw lines.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { DiffView } from "./DiffView";
import { refineProseDiff } from "@/lib/diffProse";
import type { DiffLine } from "@/lib/history";

afterEach(cleanup);

describe("DiffView", () => {
  it("renders plain =/+/- lines with their prefixes and text", () => {
    const lines: DiffLine[] = [
      ["=", "context line"],
      ["+", "added line"],
      ["-", "removed line"],
    ];
    render(<DiffView lines={lines} />);
    expect(screen.getByText("context line")).toBeInTheDocument();
    expect(screen.getByText("added line")).toBeInTheDocument();
    expect(screen.getByText("removed line")).toBeInTheDocument();
    // The "−" removed prefix is rendered (U+2212, not an ASCII hyphen).
    expect(screen.getByText("−")).toBeInTheDocument();
    expect(screen.getByText("+")).toBeInTheDocument();
  });

  it("marks added and removed lines up as <ins>/<del>, with no underline or strike", () => {
    const { container } = render(<DiffView lines={[["=", "ctx"], ["+", "new"], ["-", "old"]] as DiffLine[]} />);
    expect(container.querySelector("ins")).toHaveTextContent("new");
    expect(container.querySelector("del")).toHaveTextContent("old");
    // Color and background already carry the meaning; the UA decoration would
    // fight the diff tint, so both bodies opt out of it.
    expect(container.querySelector("ins")).toHaveClass("no-underline");
    expect(container.querySelector("del")).toHaveClass("no-underline");
  });

  it("marks intraline word changes up as <ins>/<del> too", () => {
    const lines: DiffLine[] = [["~", [["=", "the "], ["-", "old"], ["+", "new"], ["=", " word"]]]];
    const { container } = render(<DiffView lines={lines} />);
    expect(container.querySelector("del")).toHaveTextContent("old");
    expect(container.querySelector("ins")).toHaveTextContent("new");
  });

  it("keeps the change marker in its own ruled gutter, outside the line body", () => {
    const { container } = render(<DiffView lines={[["+", "added line"]] as DiffLine[]} />);
    const marker = screen.getByText("+");
    // Fixed-width column, and the body is a sibling — not nested inside the marker.
    expect(marker).toHaveStyle({ width: "20px" });
    expect(marker.contains(screen.getByText("added line"))).toBe(false);
    // The gutter column itself is painted on the box, so the box owns that seam.
    expect((container.firstChild as HTMLElement).style.background).toContain("linear-gradient");
  });

  it("renders the '…' gap marker in the gutter as a ⋯ row", () => {
    render(<DiffView lines={[["…"]]} />);
    expect(screen.getByText("⋯")).toBeInTheDocument();
  });

  it("substitutes a non-breaking space for an empty line body", () => {
    const { container } = render(<DiffView lines={[["=", ""]]} />);
    // The body span falls back to   so the empty row keeps its height.
    expect(container.textContent).toContain(" ");
  });

  it("renders a lightly edited paragraph as an inline Δ row (word-level, not promoted)", () => {
    // One short word changed in a long sentence stays below the promotion
    // threshold, so refineProseDiff leaves the "~" intraline entry intact.
    const lines: DiffLine[] = [
      [
        "~",
        [
          ["=", "The facilitator shall maintain the operational reserve at "],
          ["-", "twelve"],
          ["+", "fourteen"],
          ["=", " million units for the duration of the mandate."],
        ],
      ],
    ];
    // Sanity: this input is a passthrough (still one "~" entry after refine).
    expect(refineProseDiff(lines)).toEqual(lines);

    render(<DiffView lines={lines} />);
    expect(screen.getByText("twelve")).toBeInTheDocument();
    expect(screen.getByText("fourteen")).toBeInTheDocument();
    // The modified-line marker is Δ — a tilde reads too much like the "−" one.
    expect(screen.getByText("Δ")).toBeInTheDocument();
  });

  it("sets prose lines in the body sans and structured/frontmatter lines in mono", () => {
    // A preview patch carries the document.md frontmatter, so both kinds land
    // in one box: `key: value` and `---` stay monospace, prose does not.
    const lines: DiffLine[] = [
      ["=", "---"],
      ["-", "name: Old Document Name"],
      ["+", "name: New Document Name"],
      ["=", "The facilitator shall maintain the reserve for the mandate."],
    ];
    render(<DiffView lines={lines} />);
    expect(screen.getByText("---")).toHaveClass("mono");
    expect(screen.getByText("name: Old Document Name")).toHaveClass("mono");
    expect(screen.getByText("name: New Document Name")).toHaveClass("mono");
    const prose = screen.getByText("The facilitator shall maintain the reserve for the mandate.");
    expect(prose).not.toHaveClass("mono");
    // Prose wraps at word boundaries; only structured lines break mid-token.
    expect(prose).toHaveClass("break-words");
  });

  it("keeps a fenced block's contents in mono even when they read as prose", () => {
    // Only the ``` rows match isStructuredLine on their own; the contents have
    // to inherit from the fence or they'd flip to the sans prose treatment
    // mid-block.
    const lines: DiffLine[] = [
      ["=", "The facilitator shall maintain the reserve for the mandate."],
      ["=", "```"],
      ["+", "set the reserve to fourteen"],
      ["=", "```"],
    ];
    render(<DiffView lines={lines} />);
    const code = screen.getByText("set the reserve to fourteen");
    expect(code).toHaveClass("mono");
    expect(code).toHaveClass("break-all");
    // The prose line outside the block is unaffected.
    expect(
      screen.getByText("The facilitator shall maintain the reserve for the mandate."),
    ).not.toHaveClass("mono");
  });

  it("renders the REFINED output: a wholesale sentence rewrite promotes to −/+ rows", () => {
    // A "~" entry where the sentence is almost entirely rewritten. refineProseDiff
    // promotes this to whole-line before/after swaps; DiffView must render that
    // refined result (proving it maps `refined`, not the raw `lines`).
    const lines: DiffLine[] = [
      [
        "~",
        [
          ["-", "The old clause described a completely different obligation entirely."],
          ["+", "A wholly rewritten sentence now states an unrelated requirement instead."],
        ],
      ],
    ];
    const refined = refineProseDiff(lines);
    // Precondition for the assertion below: refinement actually changed the shape.
    expect(refined).not.toEqual(lines);
    // Every refined entry is a plain −/+/= line now (no surviving "~").
    expect(refined.every((l) => l[0] !== "~")).toBe(true);

    render(<DiffView lines={lines} />);
    // The rewritten new text renders on a promoted "+" row.
    expect(
      screen.getByText("A wholly rewritten sentence now states an unrelated requirement instead."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The old clause described a completely different obligation entirely."),
    ).toBeInTheDocument();
  });

  it("degrades to null on a malformed (non-array) payload instead of crashing", () => {
    // A legacy double-encoded jsonb diff can arrive as a string; the guard must
    // return null rather than throw. refineProseDiff itself tolerates it too.
    const { container } = render(
      <DiffView lines={"not an array" as unknown as DiffLine[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
