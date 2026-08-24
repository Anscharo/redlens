import { describe, it, expect } from "vitest";
import {
  collapseVenues,
  layoutVenueSankey,
  INNER_H,
  LEFT_GUTTER,
  RIGHT_GUTTER,
  WIDTH,
  type SankeyVenue,
} from "./settlementSankey";

function v(over: Partial<SankeyVenue> & { id: string }): SankeyVenue {
  return {
    label: over.id,
    synthetic: false,
    profitToSky: 0,
    profitToGrove: 0,
    ...over,
  };
}

describe("collapseVenues", () => {
  it("drops rows under the dollar floor and sorts by |P2S|+|P2G|", () => {
    const out = collapseVenues([
      v({ id: "tiny", profitToSky: 0.4, profitToGrove: 0.4 }),
      v({ id: "b", profitToSky: 10, profitToGrove: 0 }),
      v({ id: "a", profitToSky: 1, profitToGrove: 20 }),
    ]);
    expect(out.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("folds the tail into one Other row past topN", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      v({ id: `v${i}`, profitToSky: 15 - i, profitToGrove: 0 }),
    );
    const out = collapseVenues(many, 4);
    expect(out).toHaveLength(5);
    expect(out[4]!.id).toBe("_other");
    expect(out[4]!.label).toMatch(/Other venues \(11\)/);
    expect(out[4]!.profitToSky).toBe(
      many.slice(4).reduce((n, x) => n + x.profitToSky, 0),
    );
  });
});

describe("layoutVenueSankey", () => {
  it("returns an empty layout when nothing flows", () => {
    expect(layoutVenueSankey([], "Spark").nodes).toEqual([]);
    expect(layoutVenueSankey([v({ id: "z" })], "Spark").nodes).toEqual([]);
  });

  it("builds a left venue node and a Sky sink for a single P2S flow", () => {
    const layout = layoutVenueSankey([v({ id: "S1", label: "SparkLend", profitToSky: 100 })], "Spark");
    expect(layout.nodes.map((n) => n.id)).toEqual(["S1", "sky"]);
    expect(layout.links).toHaveLength(1);
    expect(layout.links[0]).toMatchObject({ from: "S1", to: "sky", signed: 100, value: 100 });
    expect(layout.links[0]!.path.startsWith("M")).toBe(true);
    expect(layout.height).toBeGreaterThan(0);
  });

  it("adds a prime sink when Profit to Grove is non-zero", () => {
    const layout = layoutVenueSankey(
      [v({ id: "S1", profitToSky: 60, profitToGrove: 40 })],
      "Spark",
    );
    expect(layout.nodes.map((n) => n.kind)).toEqual(["venue", "sky", "prime"]);
    expect(layout.nodes.find((n) => n.id === "prime")!.label).toBe("Spark");
    expect(layout.links).toHaveLength(2);
  });

  it("keeps Sky node height equal to the sum of incoming link thicknesses", () => {
    const layout = layoutVenueSankey(
      [
        v({ id: "a", profitToSky: 80, profitToGrove: 20 }),
        v({ id: "b", profitToSky: 20, profitToGrove: 0 }),
      ],
      "Grove",
    );
    const sky = layout.nodes.find((n) => n.id === "sky")!;
    const toSky = layout.links.filter((l) => l.to === "sky");
    // Thickness is encoded in the path's vertical span; the node height is
    // value * px, matching Σ |P2S| * px.
    expect(sky.height).toBeCloseTo(
      toSky.reduce((n, l) => n + (l.value / 120) * INNER_H, 0),
      5,
    );
  });

  it("keeps every venue label a readable distance apart, however thin the nodes", () => {
    // 12 near-zero venues under one giant: every small node collapses to MIN_PX,
    // so node centres alone would stack ~12 labels on top of each other.
    const rows = [
      v({ id: "big", profitToSky: 100_000 }),
      ...Array.from({ length: 12 }, (_, i) => v({ id: `s${i}`, profitToSky: 1 })),
    ];
    const layout = layoutVenueSankey(rows, "Spark");
    const venues = layout.nodes.filter((n) => n.kind === "venue");
    for (let i = 1; i < venues.length; i++) {
      expect(venues[i]!.labelY - venues[i - 1]!.labelY).toBeGreaterThanOrEqual(11);
    }
    // …and the box still covers the lowest label.
    expect(layout.height).toBeGreaterThan(venues[venues.length - 1]!.labelY);
  });

  it("separates the two sink labels even when one sink is a sliver", () => {
    const layout = layoutVenueSankey(
      [v({ id: "a", profitToSky: 100_000, profitToGrove: 1 })],
      "Spark",
    );
    const [sky, prime] = ["sky", "prime"].map((id) => layout.nodes.find((n) => n.id === id)!);
    // The prime node is MIN_PX tall and sits ~PAD below Sky's bottom; its
    // two-line label block would collide with Sky's without the push.
    expect(prime.labelY - sky.labelY).toBeGreaterThanOrEqual(26);
  });

  it("leaves both label gutters clear of the flow band", () => {
    const layout = layoutVenueSankey([v({ id: "a", profitToSky: 10, profitToGrove: 5 })], "Spark");
    expect(layout.width).toBe(WIDTH);
    const venue = layout.nodes.find((n) => n.kind === "venue")!;
    const sink = layout.nodes.find((n) => n.kind === "sky")!;
    expect(venue.x).toBe(LEFT_GUTTER);
    expect(layout.width - (sink.x + sink.width)).toBe(RIGHT_GUTTER);
  });

  it("draws gains and losses as separate bars, each its own gross", () => {
    // 100 in, 40 straight back out. Two bars — 100 and 40 — not one bar of 60
    // (which hid the churn) and not one of 140 (which let a loss lengthen it).
    const layout = layoutVenueSankey(
      [v({ id: "win", profitToSky: 100 }), v({ id: "lose", profitToSky: -40 })],
      "Spark",
    );
    const px = INNER_H / 140; // scale is gross activity across the venue column
    const inBar = layout.nodes.find((n) => n.id === "sky")!;
    const outBar = layout.nodes.find((n) => n.id === "sky-out")!;
    expect(inBar.flow).toBe("in");
    expect(outBar.flow).toBe("out");
    expect(inBar.height).toBeCloseTo(100 * px, 5);
    expect(outBar.height).toBeCloseTo(40 * px, 5);
  });

  it("routes a losing flow to the out bar and a gain to the in bar", () => {
    const layout = layoutVenueSankey(
      [v({ id: "win", profitToSky: 100 }), v({ id: "lose", profitToSky: -40 })],
      "Spark",
    );
    expect(layout.links.find((l) => l.from === "lose")!.to).toBe("sky-out");
    expect(layout.links.find((l) => l.from === "win")!.to).toBe("sky");
  });

  it("conserves: the sink column totals the venue column", () => {
    // The property the single netted bar broke — every unit leaving a venue
    // has to land on some bar.
    const layout = layoutVenueSankey(
      [
        v({ id: "a", profitToSky: 100, profitToGrove: -40 }),
        v({ id: "b", profitToSky: -10, profitToGrove: 25 }),
      ],
      "Spark",
    );
    const sum = (kind: "venue" | "sink") =>
      layout.nodes
        .filter((n) => (kind === "venue" ? n.kind === "venue" : n.kind !== "venue"))
        .reduce((t, n) => t + n.height, 0);
    expect(sum("sink")).toBeCloseTo(sum("venue"), 5);
  });

  it("gives a net-negative sink a taller out bar than in bar", () => {
    // grove/2026-01 was this shape: one netted bar drew a big POSITIVE block
    // for a month the prime finished behind.
    const layout = layoutVenueSankey(
      [v({ id: "win", profitToGrove: 10 }), v({ id: "lose", profitToGrove: -40 })],
      "Grove",
    );
    const inBar = layout.nodes.find((n) => n.id === "prime")!;
    const outBar = layout.nodes.find((n) => n.id === "prime-out")!;
    expect(outBar.height).toBeGreaterThan(inBar.height);
  });

  it("emits no out bar at all when nothing was lost", () => {
    const layout = layoutVenueSankey([v({ id: "a", profitToSky: 10 })], "Spark");
    expect(layout.nodes.map((n) => n.id)).toEqual(["a", "sky"]);
    expect(layout.nodes.find((n) => n.id === "sky")!.flow).toBe("in");
  });

  it("sizes every node to the ribbons that dock to it, floors included", () => {
    // One dominant venue plus a dozen sub-floor ones. Each tiny ribbon is
    // floored so it stays visible, so the floored stack is TALLER than the
    // share it represents — sizing bars from the proportional total instead
    // let ribbons spill past the bar's edge by up to 6px.
    const rows = [
      v({ id: "big", profitToSky: 1_000_000, profitToGrove: 500_000 }),
      ...Array.from({ length: 12 }, (_, i) => v({ id: `s${i}`, profitToSky: 1, profitToGrove: -1 })),
    ];
    const layout = layoutVenueSankey(rows, "Spark");
    // Ribbon thickness read off the path: M x,y0 … L x,y1b (sink end).
    const ends = (path: string) => {
      const m = /^M[\d.-]+,([\d.-]+) C.*? ([\d.-]+),([\d.-]+) L[\d.-]+,([\d.-]+)/.exec(path)!;
      return { y0: Number(m[1]), y1: Number(m[3]), y1b: Number(m[4]) };
    };
    for (const n of layout.nodes) {
      const docked = layout.links.filter((l) => (n.kind === "venue" ? l.from === n.id : l.to === n.id));
      const stacked = docked.reduce((t, l) => {
        const e = ends(l.path);
        return t + (e.y1b - e.y1);
      }, 0);
      expect(stacked, `${n.id} bar does not equal the ribbons docking to it`).toBeCloseTo(n.height, 4);
      // …and each ribbon lands inside the bar rather than past its edge.
      for (const l of docked) {
        const e = ends(l.path);
        const [top, bottom] = n.kind === "venue" ? [e.y0, e.y0] : [e.y1, e.y1b];
        expect(top).toBeGreaterThanOrEqual(n.y - 1e-6);
        expect(bottom).toBeLessThanOrEqual(n.y + n.height + 1e-6);
      }
    }
  });
});
