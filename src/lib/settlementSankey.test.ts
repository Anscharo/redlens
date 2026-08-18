import { describe, it, expect } from "vitest";
import { collapseVenues, layoutVenueSankey, type SankeyVenue } from "./settlementSankey";

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
      toSky.reduce((n, l) => n + (l.value / 120) * 380, 0),
      5,
    );
  });
});
