// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
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

  it("renders an unbacked mark with an informational accessible name and lists the unstated claim in the title", () => {
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
    expect(mark).toHaveAttribute("title", 'Not stated in this source: "The threshold is 7 signers"');
  });

  it("renders a disputed mark with a warning accessible name and lists the contradicted claim in the title", () => {
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
    expect(mark).toHaveAttribute("title", 'This source says otherwise: "The threshold is 7 signers"');
  });
});
