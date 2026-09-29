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
      <EntityResults hits={hits} query="spark" shownAt={0} />
    </Router>,
  );
  return hits;
}

describe("EntityResults", () => {
  it("renders nothing at all when there are no entity hits", () => {
    const { container } = render(<EntityResults hits={[]} query="q" shownAt={0} />);
    expect(container.firstChild).toBeNull();
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
