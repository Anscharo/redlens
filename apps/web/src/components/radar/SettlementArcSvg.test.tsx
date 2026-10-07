// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { StreamModel } from "@/lib/settlementStreams";
import { layoutSettlementArc } from "../../lib/settlementArcLayout";
import { SettlementArcSvg } from "./SettlementArcSvg";

const model: StreamModel = {
  venues: [{ id: "A", label: "A venue with a long name", synthetic: false, revenue: 5e6, sde: 0, cof: 3e6, kept: 2e6 }],
  revenue: 5e6, cof: 3e6, sde: 0, toSky: 3e6, kept: 2e6, demand: [], demandTotal: 0, demandMsc: 0,
};

describe("SettlementArcSvg", () => {
  it("draws in the Prime's frame when given one, so the box does not change with the month", () => {
    const layout = layoutSettlementArc(model);
    const { container } = render(<SettlementArcSvg layout={layout} model={model} primeLabel="Spark" inks={new Map()} frame={{ left: -400, top: 20 }} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")?.split(" ").slice(0, 2)).toEqual(["-400", "20"]);
  });
});
