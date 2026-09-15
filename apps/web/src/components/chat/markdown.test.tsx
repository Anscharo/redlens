// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
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

  it("resolves reference-style citations through the definition block", () => {
    const content =
      "[spark-rate]: /atlas/11111111-1111-1111-1111-111111111111\n" +
      "[keel-accord]: /atlas/22222222-2222-2222-2222-222222222222\n" +
      "\n" +
      "The rate is [5%][spark-rate] under the [Keel Accord][keel-accord].";
    expect(extractSources(content)).toEqual([
      { uuid: "11111111-1111-1111-1111-111111111111", title: "5%" },
      { uuid: "22222222-2222-2222-2222-222222222222", title: "Keel Accord" },
    ]);
  });

  it("dedupes a reference citation reused later, keeping the first link text", () => {
    const content =
      "[spark-rate]: /atlas/11111111-1111-1111-1111-111111111111\n\n" +
      "The rate is [5%][spark-rate], confirmed again as [five percent][spark-rate].";
    expect(extractSources(content)).toEqual([
      { uuid: "11111111-1111-1111-1111-111111111111", title: "5%" },
    ]);
  });

  it("matches labels case-insensitively and with normalized whitespace", () => {
    const content =
      "[Spark   Rate]: /atlas/11111111-1111-1111-1111-111111111111\n\n" +
      "The rate is [5%][ spark rate ].";
    expect(extractSources(content)).toEqual([
      { uuid: "11111111-1111-1111-1111-111111111111", title: "5%" },
    ]);
  });

  it("tolerates up to 3 leading spaces before a definition (CommonMark indentation)", () => {
    const content = "   [spark-rate]: /atlas/11111111-1111-1111-1111-111111111111\n\n[5%][spark-rate]";
    expect(extractSources(content)).toEqual([
      { uuid: "11111111-1111-1111-1111-111111111111", title: "5%" },
    ]);
  });

  it("mixes inline and reference-style citations in one answer, in order of appearance", () => {
    const content =
      "[keel-accord]: /atlas/22222222-2222-2222-2222-222222222222\n\n" +
      "First, [Doc One](/atlas/11111111-1111-1111-1111-111111111111) says so, " +
      "then the [Keel Accord][keel-accord] confirms it.";
    expect(extractSources(content)).toEqual([
      { uuid: "11111111-1111-1111-1111-111111111111", title: "Doc One" },
      { uuid: "22222222-2222-2222-2222-222222222222", title: "Keel Accord" },
    ]);
  });

  it("skips a label that is used but never defined", () => {
    const content = "The rate is [5%][undefined-label].";
    expect(extractSources(content)).toEqual([]);
  });

  it("skips a definition that is never used", () => {
    const content =
      "[spark-rate]: /atlas/11111111-1111-1111-1111-111111111111\n\nNo citation here.";
    expect(extractSources(content)).toEqual([]);
  });

  it("splits a malformed comma-separated label list into one citation per resolvable label", () => {
    const content =
      "[doc-a]: /atlas/11111111-1111-1111-1111-111111111111\n" +
      "[doc-b]: /atlas/22222222-2222-2222-2222-222222222222\n\n" +
      "The range is [95% down to 75%][doc-a, doc-b] overall.";
    expect(extractSources(content)).toEqual([
      { uuid: "11111111-1111-1111-1111-111111111111", title: "95% down to 75%" },
      { uuid: "22222222-2222-2222-2222-222222222222", title: "95% down to 75%" },
    ]);
  });

  it("ignores a bare bracket with no label as non-citation prose", () => {
    const content = "A range of [20 percentage points] applies here.";
    expect(extractSources(content)).toEqual([]);
  });

  it("ignores a bare bracket even when other real citations are present", () => {
    const content =
      "[spark-rate]: /atlas/11111111-1111-1111-1111-111111111111\n\n" +
      "A range of [20 percentage points] applies, per [5%][spark-rate].";
    expect(extractSources(content)).toEqual([
      { uuid: "11111111-1111-1111-1111-111111111111", title: "5%" },
    ]);
  });

  it("resolves a bare shortcut reference link ([label]) when the label is defined", () => {
    // CommonMark shortcut reference link: remark renders this as a real,
    // clickable atlas link (see the "renderer agreement" tests below), so it
    // must count as a citation, unlike an undefined bare bracket.
    const content =
      "[spark-rate]: /atlas/11111111-1111-1111-1111-111111111111\n\n" +
      "The rate is defined in [spark-rate] and applies broadly.";
    expect(extractSources(content)).toEqual([
      { uuid: "11111111-1111-1111-1111-111111111111", title: "spark-rate" },
    ]);
  });

  it("resolves a collapsed reference link ([label][]) identically to the shortcut form", () => {
    const content =
      "[spark-rate]: /atlas/11111111-1111-1111-1111-111111111111\n\n" +
      "The rate is defined in [spark-rate][] and applies broadly.";
    expect(extractSources(content)).toEqual([
      { uuid: "11111111-1111-1111-1111-111111111111", title: "spark-rate" },
    ]);
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

  it("leaves text with a complete $$ math block untouched", () => {
    const text = "Before.\n\n$$\nx^2 + y^2\n$$\n\nAfter.";
    expect(balanceFences(text)).toBe(text);
  });

  it("closes a half-open $$ block right after a paragraph break that already streamed in, not at the end", () => {
    const text =
      "Intro.\n\n$$\nx^2 + y^2\n\nAnd here is a whole extra paragraph that streamed in afterward, with [a link](/atlas/11111111-1111-1111-1111-111111111111).";
    expect(balanceFences(text)).toBe(
      "Intro.\n\n$$\nx^2 + y^2\n$$\n\nAnd here is a whole extra paragraph that streamed in afterward, with [a link](/atlas/11111111-1111-1111-1111-111111111111).",
    );
  });

  it("appends a synthetic closing $$ at the end when still mid-formula (no paragraph break yet)", () => {
    const text = "Intro.\n\n$$\nx^2 + \\frac{1}{y";
    expect(balanceFences(text)).toBe("Intro.\n\n$$\nx^2 + \\frac{1}{y\n$$");
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

// Chat shares the atlas reader's LaTeX pipeline (../lib/markdownMath.ts) so a
// formula quoted verbatim from an atlas doc — e.g. A.3.2.2.1.1.1.1.1.5's
// `$$\text{RRC} = K \times \frac{1}{CR} \times \text{EAD} \times \text{ECR}$$`
// — renders the same way in chat as it does in the reader. KaTeX is
// lazy-loaded (see chatMath.ts), so these assertions wait for it.
describe("AtlasMarkdown — math rendering", () => {
  it("renders a $$...$$ block as a KaTeX display block", async () => {
    const { container } = render(
      <AtlasMarkdown content={"$$\n\\text{RRC} = K \\times \\frac{1}{CR}\n$$"} onAtlas={vi.fn()} />,
    );
    await waitFor(() => expect(container.querySelector(".katex-display")).toBeInTheDocument());
  });

  it("renders inline $...$ math as KaTeX", async () => {
    const { container } = render(<AtlasMarkdown content="The formula is $\\text{RRC}$ here." onAtlas={vi.fn()} />);
    await waitFor(() => expect(container.querySelector(".katex")).toBeInTheDocument());
  });

  it("does not treat ordinary currency dollar amounts as math", async () => {
    render(<AtlasMarkdown content="Costs run $5,000 per month, sometimes $10 and $20." onAtlas={vi.fn()} />);
    expect(
      await screen.findByText("Costs run $5,000 per month, sometimes $10 and $20."),
    ).toBeInTheDocument();
  });

  it("still renders an atlas link in a paragraph alongside a math block", async () => {
    const onAtlas = vi.fn();
    const content =
      "See [Risk Doc](/atlas/11111111-1111-1111-1111-111111111111) for the formula:\n\n$$\nx^2 + y^2\n$$";
    const { container } = render(<AtlasMarkdown content={content} onAtlas={onAtlas} />);
    await waitFor(() => expect(container.querySelector(".katex-display")).toBeInTheDocument());
    const link = screen.getByText("Risk Doc");
    expect(link).toHaveAttribute("href", "/atlas?id=11111111-1111-1111-1111-111111111111");
    fireEvent.click(link);
    expect(onAtlas).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
  });

  it("extractSources is unaffected by math content in the same answer", () => {
    const content =
      "See [Risk Doc](/atlas/11111111-1111-1111-1111-111111111111) for the formula:\n\n$$\nx^2 + y^2\n$$";
    expect(extractSources(content)).toEqual([
      { uuid: "11111111-1111-1111-1111-111111111111", title: "Risk Doc" },
    ]);
  });
});

// The invariant that broke in production: a bare `[label]` with a matching
// definition is a CommonMark *shortcut* reference link, which remark
// resolves and renders as a real, clickable atlas `<a>` — so it must show up
// in extractSources too, or the doc is cited and visible yet missing from
// the Sources cluster. These tests render through the real AtlasMarkdown
// component (not a mock) and cross-check against extractSources on the same
// content, for both the shortcut and collapsed reference forms.
describe("renderer agreement (extractSources tracks what AtlasMarkdown actually links)", () => {
  function renderedAtlasUuids(content: string): string[] {
    const { container } = render(<AtlasMarkdown content={content} onAtlas={vi.fn()} />);
    return Array.from(container.querySelectorAll("a"))
      .map((a) => /^\/atlas\?id=([0-9a-f-]{36})$/i.exec(a.getAttribute("href") ?? "")?.[1])
      .filter((uuid): uuid is string => Boolean(uuid))
      .map((uuid) => uuid.toLowerCase());
  }

  it("a shortcut reference link ([label]) renders as an atlas link and is captured as a source", () => {
    const content =
      "[spark-rate]: /atlas/57a0be8f-c0d8-4d0c-bb99-ca3e63da5058\n\n" +
      "The rate is defined in [spark-rate] and applies broadly.";
    const rendered = renderedAtlasUuids(content);
    expect(rendered).toEqual(["57a0be8f-c0d8-4d0c-bb99-ca3e63da5058"]);
    expect(extractSources(content).map((s) => s.uuid)).toEqual(rendered);
  });

  it("a collapsed reference link ([label][]) renders identically and is captured as a source", () => {
    const content =
      "[spark-rate]: /atlas/57a0be8f-c0d8-4d0c-bb99-ca3e63da5058\n\n" +
      "The rate is defined in [spark-rate][] and applies broadly.";
    const rendered = renderedAtlasUuids(content);
    expect(rendered).toEqual(["57a0be8f-c0d8-4d0c-bb99-ca3e63da5058"]);
    expect(extractSources(content).map((s) => s.uuid)).toEqual(rendered);
  });

  it("an undefined bare bracket renders no atlas link and is not captured as a source", () => {
    const content = "A range of [20 percentage points] applies here.";
    const rendered = renderedAtlasUuids(content);
    expect(rendered).toEqual([]);
    expect(extractSources(content)).toEqual([]);
  });

  // The other half of the same invariant, in the opposite direction: models
  // wrap a citation whose link text looks like code (reward code, address) in
  // backticks, which CommonMark parses as a code span, killing the link while
  // extractSources still listed it as a source. unwrapCodeCitations repairs
  // it at render time — see citations.ts.
  it("a backticked citation still renders as an atlas link, with monospace link text", () => {
    const content = "Reward code `[128](/atlas/57a0be8f-c0d8-4d0c-bb99-ca3e63da5058)` applies.";
    const rendered = renderedAtlasUuids(content);
    expect(rendered).toEqual(["57a0be8f-c0d8-4d0c-bb99-ca3e63da5058"]);
    expect(extractSources(content)).toEqual([
      { uuid: "57a0be8f-c0d8-4d0c-bb99-ca3e63da5058", title: "128" }, // title stays un-backticked
    ]);
    expect(screen.getByRole("link").querySelector("code")).toHaveTextContent("128");
  });

  it("a backticked citation inside a GFM table cell renders as an atlas link", () => {
    const content =
      "| Agent | Reward Code |\n| - | - |\n" +
      "| Spark | `[128](/atlas/57a0be8f-c0d8-4d0c-bb99-ca3e63da5058)` |";
    expect(renderedAtlasUuids(content)).toEqual(["57a0be8f-c0d8-4d0c-bb99-ca3e63da5058"]);
  });
});
