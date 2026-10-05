// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { RadarSearchGroup } from "@/lib/radarSearch";

const track = vi.fn();
vi.mock("../../lib/analytics", () => ({ track: (...a: unknown[]) => track(...a) }));

import { RadarSearchResults } from "./RadarSearchResults";

afterEach(() => {
  cleanup();
  track.mockClear();
});

const GROUPS: RadarSearchGroup[] = [
  {
    kind: "actor",
    label: "Actors",
    total: 1,
    hits: [{ kind: "actor", label: "Spark", context: "Prime Agent", href: "/radar/spark", slug: "spark" }],
  },
  {
    kind: "instance",
    label: "Instances",
    total: 25,
    hits: [
      {
        kind: "instance",
        label: "Spark Vault",
        context: "Spark · Vault",
        href: "/radar/spark#instance-u1",
        slug: "spark",
        anchor: "instance-u1",
        excerpt: "chain: ethereum",
      },
    ],
  },
];

describe("RadarSearchResults", () => {
  it("renders a headed section per group with links and the match count", () => {
    render(<RadarSearchResults query="spark" groups={GROUPS} />);
    expect(screen.getByRole("status")).toHaveTextContent("26 matches for “spark”");
    expect(screen.getByRole("heading", { name: "Actors · 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Instances · showing 1 of 25" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Spark Vault/ })).toHaveAttribute("href", "/radar/spark#instance-u1");
    expect(screen.getByText("chain: ethereum")).toBeInTheDocument();
    expect(screen.getByText("Prime Agent")).toBeInTheDocument();
  });

  it("shows the empty state when there are no groups", () => {
    render(<RadarSearchResults query="zzz" groups={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No actor, instance, parameter, address or relationship matches “zzz”.",
    );
  });

  it("tracks a click with kind, rank, slug and anchor", () => {
    render(<RadarSearchResults query="spark" groups={GROUPS} />);
    fireEvent.click(screen.getByRole("link", { name: /Spark Vault/ }));
    expect(track).toHaveBeenCalledWith("radar_search_result_click", {
      product: "radar",
      result_kind: "instance",
      rank: 1,
      target_slug: "spark",
      anchor: "instance-u1",
    });
  });

  it("sends a null anchor for a page-level hit", () => {
    render(<RadarSearchResults query="spark" groups={GROUPS} />);
    fireEvent.click(screen.getByRole("link", { name: /Prime Agent/ }));
    expect(track).toHaveBeenCalledWith(
      "radar_search_result_click",
      expect.objectContaining({ result_kind: "actor", anchor: null }),
    );
  });
});
