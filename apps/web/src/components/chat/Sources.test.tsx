// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { AtlasNode } from "@/types";

const docs: Record<string, Pick<AtlasNode, "doc_no" | "title">> = {
  "11111111-1111-1111-1111-111111111111": { doc_no: "A.1.1", title: "Some Doc" },
};

let atlasRejects = false;
vi.mock("../../lib/docs", () => ({
  loadAtlas: () =>
    atlasRejects ? Promise.reject(new Error("boom")) : Promise.resolve({ docs }),
}));
vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));

import { Sources } from "./Sources";
import { track } from "../../lib/analytics";

afterEach(() => {
  cleanup();
  atlasRejects = false;
  vi.clearAllMocks();
});

describe("Sources", () => {
  it("renders nothing when there are no sources", () => {
    const { container } = render(<Sources sources={[]} onAtlas={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a chip per source, resolving the doc_no from the cached atlas", async () => {
    render(
      <Sources
        sources={[{ uuid: "11111111-1111-1111-1111-111111111111", title: "Some Doc" }]}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("citations · 1")).toBeInTheDocument();
    expect(screen.getByText("Some Doc")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("A.1.1")).toBeInTheDocument());
  });

  it("prefers the real doc title from docs.json over the link text once resolved", async () => {
    // Reference-style citations make link text free — a model can cite a
    // value like "5%" while the real title is something else entirely. The
    // chip must end up showing the real title, not the value it was cited as.
    render(
      <Sources
        sources={[{ uuid: "11111111-1111-1111-1111-111111111111", title: "5%" }]}
        onAtlas={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText("Some Doc")).toBeInTheDocument());
    expect(screen.queryByText("5%")).toBeNull();
  });

  it("renders the chip without a doc_no when the uuid isn't in the cached atlas", async () => {
    render(
      <Sources
        sources={[{ uuid: "22222222-2222-2222-2222-222222222222", title: "Unknown Doc" }]}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("Unknown Doc")).toBeInTheDocument();
    await waitFor(() => {}); // let the loadAtlas promise settle
    expect(screen.queryByText("A.1.1")).toBeNull();
  });

  it("tolerates a failed atlas load and still renders the chip", async () => {
    atlasRejects = true;
    render(
      <Sources
        sources={[{ uuid: "11111111-1111-1111-1111-111111111111", title: "Some Doc" }]}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("Some Doc")).toBeInTheDocument();
  });

  it("tracks a citation click and navigates via onAtlas instead of a real link nav", () => {
    const onAtlas = vi.fn();
    render(
      <Sources
        sources={[{ uuid: "11111111-1111-1111-1111-111111111111", title: "Some Doc" }]}
        onAtlas={onAtlas}
      />,
    );
    const link = screen.getByText("Some Doc").closest("a")!;
    expect(link).toHaveAttribute("href", "/atlas?id=11111111-1111-1111-1111-111111111111");
    fireEvent.click(link);
    expect(track).toHaveBeenCalledWith("chat_citation_click", {
      product: "chat",
      node_id: "11111111-1111-1111-1111-111111111111",
    });
    expect(onAtlas).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
  });

  it("offers 'view in collection' next to the count only when a collection link is given", () => {
    const { rerender } = render(<Sources sources={[{ uuid: "11111111-1111-1111-1111-111111111111", title: "Some Doc" }]} onAtlas={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "view in collection" })).toBeNull();

    const onView = vi.fn();
    rerender(
      <Sources
        sources={[{ uuid: "11111111-1111-1111-1111-111111111111", title: "Some Doc" }]}
        collection={{ onView, failed: false }}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("citations · 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "view in collection" }));
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it("reports a failed collection open next to the link", () => {
    render(
      <Sources
        sources={[{ uuid: "11111111-1111-1111-1111-111111111111", title: "Some Doc" }]}
        collection={{ onView: vi.fn(), failed: true }}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("couldn’t open");
  });

  const UUID = "11111111-1111-1111-1111-111111111111";
  const sourceFor = (uuid: string) => [{ uuid, title: "Some Doc" }];

  it("renders no mark when no marks prop is passed", () => {
    render(<Sources sources={sourceFor(UUID)} onAtlas={vi.fn()} />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders no mark when the chip's uuid is absent from the marks map", () => {
    render(
      <Sources
        sources={sourceFor(UUID)}
        marks={{ "22222222-2222-2222-2222-222222222222": { status: "backed", claims: [] } }}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders a backed mark with the correct accessible name and data-status", () => {
    render(
      <Sources sources={sourceFor(UUID)} marks={{ [UUID]: { status: "backed", claims: [] } }} onAtlas={vi.fn()} />,
    );
    const mark = screen.getByRole("img", { name: "High confidence this document states the lines that cite it" });
    expect(mark).toHaveAttribute("data-status", "backed");
    expect(mark).toHaveTextContent("✓✓");
  });

  function showTip(target: HTMLElement) {
    vi.useFakeTimers();
    try {
      fireEvent.mouseEnter(target);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      return screen.getByRole("tooltip");
    } finally {
      vi.useRealTimers();
    }
  }

  // Anything short of a sure match or a confirmed contradiction is silence.
  // The judgement is stored server-side; the chip must not ask the reader to
  // adjudicate it.
  // Only the weak-CONFIDENCE folds are hidden. A check under the measured
  // cliff was right 16 of 27 times, so drawing one asserts a sureness the
  // measurement does not support.
  it("renders no mark for a check the measurement cannot stand behind", () => {
    for (const status of ["backed_weak", "mixed", "partial"] as const) {
      const { unmount } = render(
        <Sources
          sources={sourceFor(UUID)}
          marks={{ [UUID]: { status, claims: [{ claim: "The threshold is 7 signers", verdict: "supports" }] } }}
          onAtlas={vi.fn()}
        />,
      );
      expect(screen.queryByRole("img")).toBeNull();
      unmount();
    }
  });

  // These two are categorical findings, not weak numbers, so they are drawn.
  // Hiding them would leave the harness silent about what it knows.
  it("draws a warning for a gap and for a line stated from a record alone", () => {
    const cases = [
      ["uncovered", "says_nothing", "Not stated in this document. Please double-check: “The threshold is 7 signers”"],
      ["unread", "states_content", "States what the document says: “The threshold is 7 signers”"],
    ] as const;
    for (const [status, verdict, name] of cases) {
      const { unmount } = render(
        <Sources
          sources={sourceFor(UUID)}
          marks={{ [UUID]: { status, claims: [{ claim: "The threshold is 7 signers", verdict }] } }}
          onAtlas={vi.fn()}
        />,
      );
      const glyph = screen.getByRole("img", { name });
      expect(glyph).toHaveAttribute("data-status", status);
      expect(glyph).toHaveTextContent("⚠");
      unmount();
    }
  });

  it("shows how sure the check is when hovering the source title, not only the glyph", () => {
    render(
      <Sources
        sources={sourceFor(UUID)}
        marks={{ [UUID]: { status: "backed", claims: [], confidence: 0.97 } }}
        onAtlas={vi.fn()}
      />,
    );
    const mark = screen.getByRole("img", { name: "High confidence this document states the lines that cite it" });
    expect(mark).not.toHaveAttribute("title");
    const tip = showTip(screen.getByText("Some Doc"));
    expect(tip).toHaveTextContent("High confidence this document states the lines that cite it");
  });

  it("names a confirmed contradiction without a confidence band or a percent", () => {
    render(
      <Sources
        sources={sourceFor(UUID)}
        marks={{ [UUID]: { status: "disputed", claims: [{ claim: "The fee is 10 bps", verdict: "contradicts" }], confidence: 0.2 } }}
        onAtlas={vi.fn()}
      />,
    );
    const disputed = screen.getByRole("img", { name: 'This document contradicts this line: “The fee is 10 bps”' });
    expect(disputed).toHaveAttribute("data-status", "disputed");
    expect(disputed).toHaveTextContent("!");
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("names the contradicted line when hovering anywhere on the pill, with no confidence band", () => {
    render(
      <Sources
        sources={sourceFor(UUID)}
        marks={{
          [UUID]: {
            status: "disputed",
            confidence: 0.81,
            claims: [{ claim: "The threshold is 7 signers", verdict: "contradicts" }],
          },
        }}
        onAtlas={vi.fn()}
      />,
    );
    const tip = showTip(screen.getByRole("link"));
    expect(tip).toHaveTextContent('This document contradicts this line: “The threshold is 7 signers”');
    // No band on a warning. The 0.95 threshold was measured on CHECKS, and the
    // same pass found confidence carries no information on a contradiction.
    expect(tip).not.toHaveTextContent("confidence");
  });

  it("highlights the quoted line in the answer when that tooltip line is clicked", () => {
    render(
      <div className="rlc-thread">
        <div className="rlc-turn">
          <div className="rlc-answer">The threshold is 7 signers before anything else happens.</div>
          <Sources
            sources={sourceFor(UUID)}
            marks={{
              [UUID]: {
                status: "disputed",
                confidence: 0.81,
                claims: [{ claim: "The threshold is 7 signers", verdict: "contradicts" }],
              },
            }}
            onAtlas={vi.fn()}
          />
        </div>
      </div>,
    );
    showTip(screen.getByRole("link"));
    fireEvent.click(screen.getByRole("button", { name: /The threshold is 7 signers/ }));
    const flash = document.querySelector(".rlc-answer mark.rlc-claim-flash");
    expect(flash).not.toBeNull();
    expect(flash).toHaveTextContent("The threshold is 7 signers");
  });

  it("quotes only the contradicted line, not a line the document merely fails to cover", () => {
    render(
      <Sources
        sources={sourceFor(UUID)}
        marks={{
          [UUID]: {
            status: "disputed",
            claims: [
              { claim: "Reward payments cover distributions", verdict: "says_nothing" },
              { claim: "The threshold is 7 signers", verdict: "contradicts" },
            ],
          },
        }}
        onAtlas={vi.fn()}
      />,
    );
    const tip = showTip(screen.getByRole("link"));
    expect(tip).toHaveTextContent('This document contradicts this line: “The threshold is 7 signers”');
    expect(tip).not.toHaveTextContent("Reward payments");
    expect(tip).not.toHaveTextContent("confidence");
  });

  it("renders a disputed mark with a warning accessible name", () => {
    render(
      <Sources
        sources={sourceFor(UUID)}
        marks={{
          [UUID]: { status: "disputed", claims: [{ claim: "The threshold is 7 signers", verdict: "contradicts" }] },
        }}
        onAtlas={vi.fn()}
      />,
    );
    const mark = screen.getByRole("img", { name: 'This document contradicts this line: “The threshold is 7 signers”' });
    expect(mark).toHaveAttribute("data-status", "disputed");
    expect(mark).not.toHaveAttribute("title");
  });
});
