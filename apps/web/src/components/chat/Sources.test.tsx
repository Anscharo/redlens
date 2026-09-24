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
    expect(screen.getByText("sources · 1")).toBeInTheDocument();
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
    const mark = screen.getByRole("img", { name: "Checked: this source backs the answer" });
    expect(mark).toHaveAttribute("data-status", "backed");
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

  it("renders an unbacked mark with an informational accessible name and no native title", () => {
    render(
      <Sources
        sources={sourceFor(UUID)}
        marks={{
          [UUID]: { status: "unbacked", claims: [{ claim: "The threshold is 7 signers", verdict: "says_nothing" }] },
        }}
        onAtlas={vi.fn()}
      />,
    );
    const mark = screen.getByRole("img", { name: "This source doesn't cover every line citing it" });
    expect(mark).toHaveAttribute("data-status", "unbacked");
    expect(mark).not.toHaveAttribute("title");
  });

  it("shows how sure the check is when hovering the source title, not only the glyph", () => {
    render(
      <Sources
        sources={sourceFor(UUID)}
        marks={{ [UUID]: { status: "backed", claims: [], confidence: 0.875 } }}
        onAtlas={vi.fn()}
      />,
    );
    const mark = screen.getByRole("img", { name: "High confidence this source backs the answer" });
    expect(mark).not.toHaveAttribute("title");
    const tip = showTip(screen.getByText("Some Doc"));
    expect(tip).toHaveTextContent("High confidence this source backs the answer");
  });

  it("reads confidence as medium and low bands, not a percent", () => {
    const { rerender } = render(
      <Sources
        sources={sourceFor(UUID)}
        marks={{ [UUID]: { status: "backed", claims: [], confidence: 0.5 } }}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByRole("img", { name: "Medium confidence this source backs the answer" })).toBeInTheDocument();
    rerender(
      <Sources
        sources={sourceFor(UUID)}
        marks={{ [UUID]: { status: "disputed", claims: [], confidence: 0.2 } }}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByRole("img", { name: "Low confidence this source says otherwise" })).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("shows how sure the warning is, and which line, when hovering anywhere on the pill", () => {
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
    expect(tip).toHaveTextContent("High confidence this source says otherwise");
    expect(tip).toHaveTextContent('This source says otherwise: "The threshold is 7 signers"');
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

  it("leaves the muted mark's hover as the uncovered line, with no confidence", () => {
    render(
      <Sources
        sources={sourceFor(UUID)}
        marks={{
          [UUID]: {
            status: "unbacked",
            confidence: 0.9,
            claims: [{ claim: "The threshold is 7 signers", verdict: "says_nothing" }],
          },
        }}
        onAtlas={vi.fn()}
      />,
    );
    const tip = showTip(screen.getByRole("link"));
    expect(tip).toHaveTextContent('Not stated in this source: "The threshold is 7 signers"');
    expect(tip).not.toHaveTextContent("confidence this source");
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
    const mark = screen.getByRole("img", { name: "This source may say otherwise" });
    expect(mark).toHaveAttribute("data-status", "disputed");
    expect(mark).not.toHaveAttribute("title");
  });
});
