// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { EntityResults } from "./EntityResults";
import { makeGraphEntity } from "../test/fixtures";

const track = vi.fn();
vi.mock("../lib/analytics", () => ({ track: (...a: unknown[]) => track(...a) }));

afterEach(() => {
  cleanup();
  track.mockClear();
});

function setup(count: number) {
  const hits = Array.from({ length: count }, (_, i) => ({
    participant: makeGraphEntity({ id: `e${i}`, slug: `slug-${i}`, name: `Entity ${i}`, et: "agent" }),
    score: 3,
    href: `/radar/slug-${i}`,
  }));
  const { hook } = memoryLocation({ path: "/", record: true });
  render(
    <Router hook={hook}>
      <EntityResults hits={hits} query="spark" shownAt={0} settled />
    </Router>,
  );
  return hits;
}

describe("EntityResults", () => {
  it("renders nothing while the lane has not settled — no hits YET is not no hits", () => {
    const { container } = render(<EntityResults hits={[]} query="q" shownAt={0} settled={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("says what the lane holds once it has settled on no hits", () => {
    render(<EntityResults hits={[]} query="q" shownAt={0} settled />);
    // Asserted verbatim rather than by fragment so the category names stay the
    // ones the rows themselves are labelled with — "GovOps", not "Gov Ops".
    expect(
      screen.getByText(
        "Sky Ecosystem Agents, Facilitators, GovOps, Development Companies and other entities extracted from mentions in the atlas will show here",
      ),
    ).toBeTruthy();
  });

  it("sets the hint larger than the chrome around it, and names no colour of its own", () => {
    const { container } = render(<EntityResults hits={[]} query="q" shownAt={0} settled />);
    const hint = container.querySelector("p");
    // text-base over the text-xs/text-sm everything else on this lane uses, and
    // a token rather than a literal — a literal is invisible to the contrast
    // test and breaks in every theme but the one it was written for.
    expect(hint?.className).toContain("text-base");
    expect(hint?.className).toContain("text-tan-2");
  });

  it("drops the hint as soon as there is a list to show instead", () => {
    setup(2);
    expect(screen.queryByText(/will show here/i)).toBeNull();
  });

  it("heads the list without repeating the count the line above already states", () => {
    setup(2);
    expect(screen.getByText("Entities")).toBeTruthy();
    expect(screen.queryByText(/Entities\s*2/)).toBeNull();
  });

  it("links each entity to its radar page", () => {
    setup(3);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute("href", "/radar/slug-0");
  });

  it("records a click with its 1-based rank within this list", () => {
    setup(6);
    fireEvent.click(screen.getAllByRole("link")[5]);
    expect(track).toHaveBeenCalledWith(
      "search_result_click",
      expect.objectContaining({
        result_kind: "entity",
        query: "spark",
        rank: 6,
        in_top_5: false,
        result_count: 6,
        entity_slug: "slug-5",
      }),
    );
  });
});
